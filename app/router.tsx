import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import {
  Provider,
  Client,
  cacheExchange,
  fetchExchange,
  Exchange,
  Operation,
} from "urql";
import { ssrExchange } from "./exchange";

export function createRouter() {
  function getKey(operation: Operation) {
    return "__URQL__" + operation.key;
  }
  const ssr = ssrExchange({
    isClient: typeof document !== "undefined",
    streamQuery: (result, serializedResult) => {
      const key = getKey(result.operation);
      if (router.streamedKeys.has(key)) {
        return;
      }
      router.streamValue(key, serializedResult);
    },
    getStreamedQuery: (op) => {
      return router.getStreamedValue<any>(getKey(op));
    },
  });

  // ssr must be before fetchExchange!
  const exchanges: Exchange[] = [cacheExchange, ssr, fetchExchange];

  const urqlClient = new Client({
    url: "https://trygql.formidable.dev/graphql/basic-pokedex",
    exchanges,
    suspense: true,
  });

  const router = createTanStackRouter({
    routeTree,
    context: {
      urqlClient,
    },
    Wrap: ({ children }) => <Provider value={urqlClient}>{children}</Provider>,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
