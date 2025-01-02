import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import {
  Provider,
  Client,
  cacheExchange,
  fetchExchange,
  Exchange,
} from "urql";
import { SSRDataStorage, ssrExchange } from "./exchange";

export function createRouter() {
  function getKey(key: string) {
    return `__URQL__${key}`;
  }
  const storage: SSRDataStorage = new Proxy({} as SSRDataStorage, {
    get(_, prop) {
      if (typeof prop === "string") {
        return router.getStreamedValue(getKey(prop));
      }
      return undefined;
    },
    set(_, prop, value) {
      if (typeof prop === "string") {
        if (router.isServer) {
          router.streamValue(getKey(prop), value);
        }
        return true;
      }
      return false;
    },
    has(_, prop) {
      if (typeof prop === "string") {
        return router.getStreamedValue(getKey(prop)) !== undefined;
      }
      return false;
    },
  });

  const ssr = ssrExchange({
    isClient: typeof document !== "undefined",
    storage,
  });

  // ssr must be between cacheExchange and fetchExchange!
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
