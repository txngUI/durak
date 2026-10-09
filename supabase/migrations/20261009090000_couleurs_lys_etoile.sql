-- Durak : à 5 ou 6 joueurs, deux couleurs en plus (L = lys, E = étoile).
-- L'atout d'une partie enregistrée peut donc être l'une de ces deux couleurs.
-- À exécuter une fois dans Supabase → SQL Editor.

alter table public.games drop constraint if exists games_trump_suit_check;
alter table public.games
  add constraint games_trump_suit_check check (trump_suit in ('C', 'D', 'H', 'S', 'L', 'E'));
