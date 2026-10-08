-- Durak V2 · étape 1 : comptes, parties et statistiques.
-- À exécuter une fois dans Supabase → SQL Editor (ou `supabase db push`).
--
-- Principe de sécurité : tout le monde peut LIRE profils et statistiques,
-- mais seules les écritures du serveur de jeu (clé service, qui contourne RLS)
-- créent des profils ou enregistrent des parties. Le navigateur ne peut rien écrire.

-- ---------------------------------------------------------------------------
-- Profils : un par compte, créé par le serveur quand le joueur choisit son pseudo
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 2 and 16),
  color smallint not null default 0 check (color between 0 and 7),
  avatar_url text,
  created_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

-- ---------------------------------------------------------------------------
-- Parties terminées et place de chaque joueur
-- ---------------------------------------------------------------------------
create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  player_count smallint not null check (player_count between 2 and 6),
  rounds smallint not null,
  trump_suit char(1) not null check (trump_suit in ('C', 'D', 'H', 'S')),
  with_bots boolean not null default false
);
create index games_ended_at_idx on public.games (ended_at desc);

create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  seat smallint not null,
  profile_id uuid references public.profiles (id) on delete set null, -- null : invité
  display_name text not null,
  place smallint, -- 0 = Korol ; null = durak
  is_korol boolean not null default false,
  is_durak boolean not null default false,
  cards_left smallint not null default 0,
  primary key (game_id, seat)
);
create index game_players_profile_idx on public.game_players (profile_id);

-- ---------------------------------------------------------------------------
-- Droits : lecture publique, aucune écriture depuis le navigateur
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

create policy "profils lisibles par tous" on public.profiles for select using (true);
create policy "parties lisibles par tous" on public.games for select using (true);
create policy "joueurs des parties lisibles par tous" on public.game_players for select using (true);

grant select on public.profiles, public.games, public.game_players to anon, authenticated;
revoke insert, update, delete on public.profiles, public.games, public.game_players from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Statistiques (les parties avec des bots ne comptent pas)
-- ---------------------------------------------------------------------------
create view public.player_stats with (security_invoker = true) as
select
  p.id,
  p.username,
  p.color,
  p.avatar_url,
  coalesce(s.games, 0)::int as games,
  coalesce(s.korol, 0)::int as korol,
  coalesce(s.durak, 0)::int as durak
from public.profiles p
left join (
  select
    gp.profile_id,
    count(*) as games,
    count(*) filter (where gp.is_korol) as korol,
    count(*) filter (where gp.is_durak) as durak
  from public.game_players gp
  join public.games g on g.id = gp.game_id
  where not g.with_bots and gp.profile_id is not null
  group by gp.profile_id
) s on s.profile_id = p.id;

grant select on public.player_stats to anon, authenticated;

-- Classement : joueurs ayant au moins `min_games` parties depuis `since`.
-- order_by = 'korol' : meilleur % de Korol ; 'durak' : plus faible % de durak.
create function public.leaderboard(
  since timestamptz default null,
  order_by text default 'korol',
  min_games int default 10
)
returns table (
  rank bigint,
  id uuid,
  username text,
  color smallint,
  avatar_url text,
  games int,
  korol int,
  durak int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select
      gp.profile_id,
      count(*)::int as games,
      (count(*) filter (where gp.is_korol))::int as korol,
      (count(*) filter (where gp.is_durak))::int as durak
    from public.game_players gp
    join public.games g on g.id = gp.game_id
    where not g.with_bots
      and gp.profile_id is not null
      and (since is null or g.ended_at >= since)
    group by gp.profile_id
    having count(*) >= min_games
  )
  select
    row_number() over (
      order by
        case when order_by = 'durak' then -(s.durak::numeric / s.games) else s.korol::numeric / s.games end desc,
        s.games desc,
        p.username
    ) as rank,
    p.id,
    p.username,
    p.color,
    p.avatar_url,
    s.games,
    s.korol,
    s.durak
  from s
  join public.profiles p on p.id = s.profile_id
  order by rank;
$$;

grant execute on function public.leaderboard(timestamptz, text, int) to anon, authenticated;

-- Historique d'un joueur : ses dernières parties, avec les pseudos des autres joueurs.
create function public.player_history(p_id uuid, max_rows int default 20)
returns table (
  ended_at timestamptz,
  player_count smallint,
  place smallint,
  is_korol boolean,
  is_durak boolean,
  with_bots boolean,
  others text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.ended_at,
    g.player_count,
    me.place,
    me.is_korol,
    me.is_durak,
    g.with_bots,
    array(
      select o.display_name from public.game_players o
      where o.game_id = g.id and o.seat <> me.seat
      order by o.seat
    ) as others
  from public.game_players me
  join public.games g on g.id = me.game_id
  where me.profile_id = p_id
  order by g.ended_at desc
  limit least(max_rows, 100);
$$;

grant execute on function public.player_history(uuid, int) to anon, authenticated;
