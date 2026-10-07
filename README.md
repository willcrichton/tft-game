# Pick 15 / Tic-tac-toe

A live classroom demo of problem isomorphs. Students are split into Red and Blue teams and play Pick 15, collectively voting on each move Twitch-Plays-style. Next they play tic-tac-toe. The reveal overlays the magic square on the board and replays the Pick 15 game as tic-tac-toe.

- Students: `https://<user>.github.io/<repo>/`
- Instructor: `https://<user>.github.io/<repo>/#admin`

## Setup

1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql`, then set the admin passphrase:
   ```sql
   insert into admin_config (secret) values ('your passphrase')
   on conflict (id) do update set secret = excluded.secret;
   ```
2. Copy `.env.example` to `.env` and fill in the project URL and anon (publishable) key from Project Settings → API. The anon key is public by design: students can only read the game row and vote through `cast_vote`, and every state change goes through passphrase-checked `admin_*` RPCs.
3. In the GitHub repo, set Settings → Pages → Source to "GitHub Actions". Pushing to `main` deploys.

## Running a session

1. Open `#admin` and share that screen. The lobby shows the join URL and team counts.
2. **Pick 15** → **▶ Play** (or Space). Voting windows alternate between teams on their own. When a window closes, the plurality choice is played; ties are broken at random, and if nobody voted a random legal move is played. **Undo** and **Restart** are there for mishaps.
3. **Tic-tac-toe** → **▶ Play**.
4. **Reveal** → **Next ▶** (or →): first the final tic-tac-toe board, then the magic-square overlay, then a move-by-move replay of the Pick 15 game on the board.

The admin tab tallies the votes and advances rounds, so keep it open and in the foreground while playing.

## Pre-class check

Both scripts reset the live game afterwards and need `.admin-passphrase` (gitignored) in the repo root.

```sh
pnpm smoke           # API-level: 6 simulated students play both games through RPCs and Realtime
pnpm smoke:browser   # real Chrome: admin + 4 student tabs click through both games and the reveal
```

## Development

```sh
depot build -w   # dev server
depot test       # unit, component, and database tests (Postgres via PGlite)
```
