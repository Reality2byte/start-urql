import { createFileRoute } from "@tanstack/react-router";

import { Pokemons } from "./-components/Pokemons";

export const Route = createFileRoute("/")({
  loader: async ({ context: { urqlClient } }) => {
    // const result = await urqlClient.query(PokemonsQuery, {}).toPromise();
    // return result.data
    // return { urqlPromise: urqlClient.query(PokemonsQuery, {}).toPromise()}
  },
  component: Pokemons,
});


