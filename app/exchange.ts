import { pipe, filter, merge, map, tap } from "wonka";
import {
  Exchange,
  OperationResult,
  Operation,
  formatDocument,
  makeOperation,
} from "urql";
import { CombinedError, OperationDebugMeta } from "@urql/core";

/**
 * copied from urql as they are not exported
 */

export const mapTypeNames = (operation: Operation): Operation => {
  const query = formatDocument(operation.query);
  if (query !== operation.query) {
    const formattedOperation = makeOperation(operation.kind, operation);
    formattedOperation.query = query;
    return formattedOperation;
  } else {
    return operation;
  }
};

export const addMetadata = (
  operation: Operation,
  meta: OperationDebugMeta
): Operation =>
  makeOperation(operation.kind, operation, {
    ...operation.context,
    meta: {
      ...operation.context.meta,
      ...meta,
    },
  });

// this is adapted from urql's ssrExchange

/** A serialized version of an {@link OperationResult}.
 *
 * @remarks
 * All properties are serialized separately as JSON strings, except for the
 * {@link CombinedError} to speed up JS parsing speed, even if a result doesn’t
 * end up being used.
 *
 * @internal
 */
export interface SerializedResult {
  hasNext?: boolean;
  /** JSON-serialized version of {@link OperationResult.data}. */
  data?: string | undefined; // JSON string of data
  /** JSON-serialized version of {@link OperationResult.extensions}. */
  extensions?: string | undefined;
  /** JSON version of {@link CombinedError}. */
  error?: {
    graphQLErrors: Array<Partial</*GraphQLError*/ any> | string>;
    networkError?: string;
  };
}

/** A dictionary of {@link Operation.key} keys to serializable {@link SerializedResult} objects.
 *
 * @remarks
 * It’s not recommended to modify the serialized data manually, however, multiple payloads of
 * this dictionary may safely be merged and combined.
 */
export interface SSRData {
  [key: string]: SerializedResult;
}

/** Options for the `ssrExchange` allowing it to either operate on the server- or client-side. */
export interface SSRExchangeParams {
  /** Indicates to the {@link SSRExchange} whether it's currently in server-side or client-side mode.
   *
   * @remarks
   * Depending on this option, the {@link SSRExchange} will either capture or replay results.
   * When `true`, it’s in client-side mode and results will be serialized. When `false`, it’ll
   * use its deserialized data and replay results from it.
   */
  isClient?: boolean;

  /** Forces a new API request to be sent in the background after replaying the deserialized result.
   *
   * @remarks
   * Similarly to the `cache-and-network` {@link RequestPolicy}, this option tells the {@link SSRExchange}
   * to send a new API request for the {@link Operation} after replaying a serialized result.
   *
   * Hint: This is useful when you're caching SSR results and need the client-side to update itself after
   * rendering the initial serialized SSR results.
   */
  staleWhileRevalidate?: boolean;
  /** Forces {@link OperationResult.extensions} to be serialized alongside the rest of a result.
   *
   * @remarks
   * Entries in the `extension` object of a GraphQL result are often non-standard metdata, and many
   * APIs use it for data that changes between every request. As such, the {@link SSRExchange} will
   * not serialize this data by default, unless this flag is set.
   */
  includeExtensions?: boolean;


  // new options
  getStreamedQuery: (operation: Operation) => SerializedResult;
  streamQuery: (result: OperationResult, serializedResult: SerializedResult) => void;
}

/** Serialize an OperationResult to plain JSON */
const serializeResult = (
  result: OperationResult,
  includeExtensions: boolean
): SerializedResult => {
  const serialized: SerializedResult = {
    hasNext: result.hasNext,
  };

  if (result.data !== undefined) {
    serialized.data = JSON.stringify(result.data);
  }

  if (includeExtensions && result.extensions !== undefined) {
    serialized.extensions = JSON.stringify(result.extensions);
  }

  if (result.error) {
    serialized.error = {
      graphQLErrors: result.error.graphQLErrors.map((error) => {
        if (!error.path && !error.extensions) return error.message;

        return {
          message: error.message,
          path: error.path,
          extensions: error.extensions,
        };
      }),
    };

    if (result.error.networkError) {
      serialized.error.networkError = "" + result.error.networkError;
    }
  }

  return serialized;
};

/** Deserialize plain JSON to an OperationResult
 * @internal
 */
const deserializeResult = (
  operation: Operation,
  result: SerializedResult,
  includeExtensions: boolean
): OperationResult => ({
  operation,
  data: result.data ? JSON.parse(result.data) : undefined,
  extensions:
    includeExtensions && result.extensions
      ? JSON.parse(result.extensions)
      : undefined,
  error: result.error
    ? new CombinedError({
        networkError: result.error.networkError
          ? new Error(result.error.networkError)
          : undefined,
        graphQLErrors: result.error.graphQLErrors,
      })
    : undefined,
  stale: false,
  hasNext: !!result.hasNext,
});

const revalidated = new Set<number>();

/** Creates a server-side rendering `Exchange` that either captures responses on the server-side or replays them on the client-side.
 *
 * @param params - An {@link SSRExchangeParams} configuration object.
 * @returns the created {@link SSRExchange}
 *
 * @remarks
 * When dealing with server-side rendering, we essentially have two {@link Client | Clients} making requests,
 * the server-side client, and the client-side one. The `ssrExchange` helps implementing a tiny cache on both
 * sides that:
 *
 * - captures results on the server-side which it can serialize,
 * - replays results on the client-side that it deserialized from the server-side.
 *
 * Hint: The `ssrExchange` is basically an exchange that acts like a replacement for any fetch exchange
 * temporarily. As such, you should place it after your cache exchange but in front of any fetch exchange.
 */
export const ssrExchange = (params: SSRExchangeParams) => {
  const staleWhileRevalidate = !!params.staleWhileRevalidate;
  const includeExtensions = !!params.includeExtensions;
  const data: Record<string, SerializedResult | null> = {};

  // On the client-side, we delete results from the cache as they're resolved
  // this is delayed so that concurrent queries don't delete each other's data
  const invalidateQueue: number[] = [];
  const invalidate = (result: OperationResult) => {
    invalidateQueue.push(result.operation.key);
    if (invalidateQueue.length === 1) {
      Promise.resolve().then(() => {
        let key: number | void;
        while ((key = invalidateQueue.shift())) {
          data[key] = null;
        }
      });
    }
  };

  // The SSR Exchange is a temporary cache that can populate results into data for suspense
  // On the client it can be used to retrieve these temporary results from a rehydrated cache
  const ssr : Exchange =
    ({ client, forward }) =>
    (ops$) => {
      // params.isClient tells us whether we're on the client-side
      // By default we assume that we're on the client if suspense-mode is disabled
      const isClient =
        params && typeof params.isClient === "boolean"
          ? !!params.isClient
          : !client.suspense;
      let forwardedOps$ = pipe(
        ops$,
        filter(
          (operation) =>
            operation.kind === "teardown" ||
            !params.getStreamedQuery(operation) ||
            !!params.getStreamedQuery?.(operation)!.hasNext ||
            operation.context.requestPolicy === "network-only"
        ),
        map(mapTypeNames),
        forward
      );

      // NOTE: Since below we might delete the cached entry after accessing
      // it once, cachedOps$ needs to be merged after forwardedOps$
      let cachedOps$ = pipe(
        ops$,
        filter(
          (operation) =>
            operation.kind !== "teardown" &&
            !!params.getStreamedQuery(operation) &&
            operation.context.requestPolicy !== "network-only"
        ),
        map((op) => {
          const serialized = params.getStreamedQuery(op)!
          const cachedResult = deserializeResult(
            op,
            serialized,
            includeExtensions
          );

          if (staleWhileRevalidate && !revalidated.has(op.key)) {
            cachedResult.stale = true;
            revalidated.add(op.key);
            client.reexecuteOperation(op);
          }

          const result: OperationResult = {
            ...cachedResult,
            operation: addMetadata(op, {
              cacheOutcome: "hit",
            }),
          };
          return result;
        })
      );

      if (!isClient) {
        // On the server we cache results in the cache as they're resolved
        forwardedOps$ = pipe(
          forwardedOps$,
          tap((result: OperationResult) => {
            const { operation } = result;
            if (operation.kind !== "mutation") {
              const serialized = serializeResult(result, includeExtensions);
              params.streamQuery(result, serialized);
            }
          })
        );
      } else {
        // On the client we delete results from the cache as they're resolved
        cachedOps$ = pipe(cachedOps$, tap(invalidate));
      }

      return merge([forwardedOps$, cachedOps$]);
    };

  return ssr;
};
