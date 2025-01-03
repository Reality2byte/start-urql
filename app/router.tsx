import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import {
  Provider,
  Client,
  cacheExchange,
  fetchExchange,
  Exchange,
  ssrExchange,
} from "urql";
import { UrqlProvider } from "./@urql/tanstack-start/Provider";

export function createRouter() {
  
  const ssr = ssrExchange({isClient: typeof window !== "undefined"});
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
    Wrap: ({ children }) => <UrqlProvider ssr={ssr} client={urqlClient}>{children}</UrqlProvider>,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
