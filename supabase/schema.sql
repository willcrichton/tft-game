create table if not exists public.game (
  id int primary key default 1 check (id = 1),
  phase text not null default 'lobby' check (phase in ('lobby', 'ns', 'ttt', 'reveal')),
  ns_moves int[] not null default '{}',
  ttt_moves int[] not null default '{}',
  ns_result text check (ns_result in ('red', 'blue', 'draw')),
  ttt_result text check (ttt_result in ('red', 'blue', 'draw')),
  round int not null default 0,
  round_starts_at timestamptz,
  round_ends_at timestamptz,
  paused boolean not null default true,
  window_secs numeric not null default 5 check (window_secs > 0),
  gap_secs numeric not null default 2 check (gap_secs >= 0),
  reveal_step int not null default 0,
  team_epoch int not null default 0
);

insert into public.game (id) values (1) on conflict do nothing;

create table if not exists public.players (
  id uuid primary key,
  team text not null check (team in ('red', 'blue')),
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  round int not null,
  player_id uuid not null references public.players (id) on delete cascade,
  choice int not null,
  created_at timestamptz not null default now(),
  primary key (round, player_id)
);

create table if not exists public.admin_config (
  id int primary key default 1 check (id = 1),
  secret text not null
);

alter table public.game enable row level security;
alter table public.players enable row level security;
alter table public.votes enable row level security;
alter table public.admin_config enable row level security;

drop policy if exists game_read on public.game;
create policy game_read on public.game for select to anon, authenticated using (true);
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.game, public.votes to anon, authenticated;
revoke all on public.admin_config from anon, authenticated;
revoke insert, update, delete on public.game, public.players, public.votes from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game'
  ) then
    alter publication supabase_realtime add table public.game;
  end if;
end $$;

create or replace function public.moves_of(g public.game) returns int[]
language sql immutable as $$
  select case g.phase when 'ns' then g.ns_moves when 'ttt' then g.ttt_moves else '{}'::int[] end
$$;

create or replace function public.result_of(g public.game) returns text
language sql immutable as $$
  select case g.phase when 'ns' then g.ns_result when 'ttt' then g.ttt_result end
$$;

create or replace function public.turn_team(moves int[]) returns text
language sql immutable as $$
  select case when coalesce(array_length(moves, 1), 0) % 2 = 0 then 'red' else 'blue' end
$$;

create or replace function public.is_legal(phase text, moves int[], choice int) returns boolean
language sql immutable as $$
  select case phase
    when 'ns' then choice between 1 and 9
    when 'ttt' then choice between 0 and 8
    else false
  end and not (choice = any (moves))
$$;

create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now() $$;

create or replace function public.join_game(p_player uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text;
  r int;
  b int;
begin
  select team into t from players where id = p_player;
  if t is not null then
    return t;
  end if;
  perform pg_advisory_xact_lock(15);
  select count(*) filter (where team = 'red'), count(*) filter (where team = 'blue')
    into r, b from players;
  t := case
    when r < b then 'red'
    when b < r then 'blue'
    when random() < 0.5 then 'red'
    else 'blue'
  end;
  insert into players (id, team) values (p_player, t) on conflict (id) do nothing;
  select team into t from players where id = p_player;
  return t;
end $$;

create or replace function public.team_counts() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'red', count(*) filter (where team = 'red'),
    'blue', count(*) filter (where team = 'blue')
  ) from players
$$;

create or replace function public.cast_vote(p_player uuid, p_round int, p_choice int) returns text
language plpgsql security definer set search_path = public as $$
declare
  g game;
  t text;
begin
  select * into g from game where id = 1;
  if g.phase not in ('ns', 'ttt') or result_of(g) is not null then
    return 'not_playing';
  end if;
  if g.paused or g.round <> p_round
    or now() < g.round_starts_at
    or now() > g.round_ends_at + interval '300 milliseconds' then
    return 'closed';
  end if;
  select team into t from players where id = p_player;
  if t is null then
    return 'unknown_player';
  end if;
  if t <> turn_team(moves_of(g)) then
    return 'not_your_turn';
  end if;
  if not is_legal(g.phase, moves_of(g), p_choice) then
    return 'illegal';
  end if;
  insert into votes (round, player_id, choice) values (p_round, p_player, p_choice)
    on conflict (round, player_id) do update set choice = excluded.choice, created_at = now();
  return 'ok';
end $$;

create or replace function public.assert_admin(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where id = 1 and secret = p_secret) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_check(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_config where id = 1 and secret = p_secret)
$$;

create or replace function public.admin_set_phase(p_secret text, p_phase text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set
    phase = p_phase,
    paused = true,
    round = round + 1,
    round_starts_at = null,
    round_ends_at = null
  where id = 1;
end $$;

create or replace function public.admin_play(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game g set
    paused = false,
    round = round + 1,
    round_starts_at = now(),
    round_ends_at = now() + make_interval(secs => window_secs)
  where id = 1 and phase in ('ns', 'ttt') and result_of(g) is null;
end $$;

create or replace function public.admin_pause(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set
    paused = true,
    round = round + 1,
    round_starts_at = null,
    round_ends_at = null
  where id = 1;
end $$;

create or replace function public.admin_apply(p_secret text, p_round int, p_choice int, p_result text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  g game;
  done boolean := p_result is not null;
begin
  perform assert_admin(p_secret);
  select * into g from game where id = 1 for update;
  if g.paused or g.round <> p_round or result_of(g) is not null
    or not is_legal(g.phase, moves_of(g), p_choice) then
    return false;
  end if;
  update game set
    ns_moves = case when phase = 'ns' then ns_moves || p_choice else ns_moves end,
    ns_result = case when phase = 'ns' then p_result else ns_result end,
    ttt_moves = case when phase = 'ttt' then ttt_moves || p_choice else ttt_moves end,
    ttt_result = case when phase = 'ttt' then p_result else ttt_result end,
    round = round + 1,
    paused = done,
    round_starts_at = case when done then null else now() + make_interval(secs => gap_secs) end,
    round_ends_at = case when done then null else now() + make_interval(secs => gap_secs + window_secs) end
  where id = 1;
  return true;
end $$;

create or replace function public.admin_undo(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set
    ns_moves = case when phase = 'ns' then trim_array(ns_moves, least(1, cardinality(ns_moves))) else ns_moves end,
    ns_result = case when phase = 'ns' then null else ns_result end,
    ttt_moves = case when phase = 'ttt' then trim_array(ttt_moves, least(1, cardinality(ttt_moves))) else ttt_moves end,
    ttt_result = case when phase = 'ttt' then null else ttt_result end,
    paused = true,
    round = round + 1,
    round_starts_at = null,
    round_ends_at = null
  where id = 1;
end $$;

create or replace function public.admin_restart(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set
    ns_moves = case when phase = 'ns' then '{}' else ns_moves end,
    ns_result = case when phase = 'ns' then null else ns_result end,
    ttt_moves = case when phase = 'ttt' then '{}' else ttt_moves end,
    ttt_result = case when phase = 'ttt' then null else ttt_result end,
    reveal_step = 0,
    paused = true,
    round = round + 1,
    round_starts_at = null,
    round_ends_at = null
  where id = 1;
end $$;

create or replace function public.admin_settings(p_secret text, p_window_secs numeric, p_gap_secs numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set
    window_secs = coalesce(p_window_secs, window_secs),
    gap_secs = coalesce(p_gap_secs, gap_secs)
  where id = 1;
end $$;

create or replace function public.admin_reveal(p_secret text, p_step int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  update game set reveal_step = greatest(0, p_step) where id = 1;
end $$;

create or replace function public.admin_reshuffle(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
declare
  flip int := (random() < 0.5)::int;
begin
  perform assert_admin(p_secret);
  with s as (select id, row_number() over (order by random()) as rn from players)
  update players p set team = case when (s.rn + flip) % 2 = 0 then 'red' else 'blue' end
  from s where p.id = s.id;
  update game set
    team_epoch = team_epoch + 1,
    paused = true,
    round = round + 1,
    round_starts_at = null,
    round_ends_at = null
  where id = 1;
end $$;

create or replace function public.admin_reset_all(p_secret text, p_clear_players boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin(p_secret);
  delete from votes where true;
  if p_clear_players then
    delete from players where true;
  end if;
  update game set
    phase = 'lobby',
    ns_moves = '{}',
    ttt_moves = '{}',
    ns_result = null,
    ttt_result = null,
    round = round + 1,
    paused = true,
    round_starts_at = null,
    round_ends_at = null,
    reveal_step = 0,
    team_epoch = team_epoch + 1
  where id = 1;
end $$;

grant execute on all functions in schema public to anon, authenticated;
revoke execute on function public.assert_admin(text) from public, anon, authenticated;
