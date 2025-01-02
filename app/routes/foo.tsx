import { createFileRoute } from '@tanstack/react-router'
import { Pokemons } from './-components/Pokemons'

export const Route = createFileRoute('/foo')({
  component: Pokemons,
})
