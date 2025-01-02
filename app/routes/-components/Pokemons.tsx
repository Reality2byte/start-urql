import { gql, useQuery } from "urql";

const PokemonsQuery = gql`
  query {
    pokemons(limit: 10) {
      id
      name
    }
  }
`;


export function Pokemons() {
  const [result] = useQuery({ query: PokemonsQuery });
    if (result.fetching) {
        return <div>Loading...</div>;
        }
  return (
    <main>
      <h1>This is rendered as part of SSR</h1>
      <ul>
        {result.data.pokemons.map((x: any) => (
          <li key={x.id}>{x.name}</li>
        ))}
      </ul>
    </main>
  );
}
