import React, { useEffect, useRef, useState } from "react";
import { type Admin, admin, fetchVotes, teamCounts } from "./api";
import { GameScreen, RevealScreen, teamName } from "./components";
import { useClockOffset, useGame, useNow } from "./hooks";
import {
  legalMoves,
  outcome,
  type Phase,
  pickMove,
  revealSteps,
  TEAMS,
  type Team,
  tally
} from "./logic";
import { type GameRow, kindOf, movesOf, shouldResolve, status } from "./state";

const SECRET_KEY = "tft-admin-secret";

export let resolveRound = async (api: Admin, g: GameRow) => {
  let kind = kindOf(g);
  if (!kind) return;
  let moves = movesOf(g, kind);
  let legal = legalMoves(kind, moves);
  let votes = await fetchVotes(g.round);
  let choice = pickMove(votes, legal);
  let result = outcome(kind, [...moves, choice]).result;
  await api.apply(g.round, choice, result);
};

let useResolver = (api: Admin, g: GameRow | null, offset: number) => {
  let gRef = useRef(g);
  gRef.current = g;
  let resolving = useRef<number | null>(null);
  useEffect(() => {
    let id = setInterval(() => {
      let cur = gRef.current;
      if (!cur || resolving.current === cur.round) return;
      if (!shouldResolve(cur, Date.now() + offset)) return;
      let round = cur.round;
      resolving.current = round;
      resolveRound(api, cur).catch(e => {
        console.error(e);
        if (resolving.current === round) resolving.current = null;
      });
    }, 100);
    return () => clearInterval(id);
  }, [api, offset]);
};

let useTally = (g: GameRow | null, now: number) => {
  let [votes, setVotes] = useState<{ round: number; votes: number[] }>({
    round: -1,
    votes: []
  });
  let live = g ? ["open", "closing"].includes(status(g, now).kind) : false;
  let round = g?.round ?? -1;
  useEffect(() => {
    if (!live) return;
    let alive = true;
    let poll = () =>
      fetchVotes(round)
        .then(v => alive && setVotes({ round, votes: v }))
        .catch(console.error);
    poll();
    let id = setInterval(poll, 400);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, round]);
  if (!g || votes.round !== g.round) return { counts: new Map(), total: 0 };
  let kind = kindOf(g);
  let legal = kind ? legalMoves(kind, movesOf(g, kind)) : [];
  return { counts: tally(votes.votes, legal), total: votes.votes.length };
};

let useTeamCounts = () => {
  let [counts, setCounts] = useState<Record<Team, number>>({
    red: 0,
    blue: 0
  });
  useEffect(() => {
    let poll = () => teamCounts().then(setCounts).catch(console.error);
    poll();
    let id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);
  return counts;
};

export let ConfirmButton = ({
  onConfirm,
  children,
  className
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  className?: string;
}) => {
  let [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    let id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className ?? ""} ${armed ? "armed" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? "Click again to confirm" : children}
    </button>
  );
};

const PHASES: { phase: Phase; label: string }[] = [
  { phase: "lobby", label: "Lobby" },
  { phase: "ns", label: "Pick 15" },
  { phase: "ttt", label: "Tic-tac-toe" },
  { phase: "reveal", label: "Reveal" }
];

let studentUrl = () => window.location.href.replace(/#.*$/, "");

let Projector = ({
  g,
  now,
  counts
}: {
  g: GameRow;
  now: number;
  counts: Record<Team, number>;
}) => {
  let t = useTally(g, now);
  if (g.phase === "lobby")
    return (
      <div className="screen lobby">
        <h1>Join the game</h1>
        <p className="join-url">{studentUrl()}</p>
        <div className="team-counts big">
          {TEAMS.map(team => (
            <div key={team} className={`team-count ${team}`}>
              <span>{counts[team]}</span> {teamName(team)}
            </div>
          ))}
        </div>
      </div>
    );
  if (g.phase === "reveal") return <RevealScreen g={g} />;
  return (
    <>
      <GameScreen g={g} now={now} myTeam={null} tally={t.counts} />
      <div className="vote-total">
        {t.total} vote{t.total === 1 ? "" : "s"}
      </div>
    </>
  );
};

export let Controls = ({
  api,
  g,
  counts,
  onLogout
}: {
  api: Admin;
  g: GameRow;
  counts: Record<Team, number>;
  onLogout: () => void;
}) => {
  let [windowSecs, setWindowSecs] = useState(String(g.window_secs));
  let [gapSecs, setGapSecs] = useState(String(g.gap_secs));
  useEffect(() => setWindowSecs(String(g.window_secs)), [g.window_secs]);
  useEffect(() => setGapSecs(String(g.gap_secs)), [g.gap_secs]);
  let [clearPlayers, setClearPlayers] = useState(false);
  let [err, setErr] = useState<string | null>(null);
  let run = (f: () => Promise<unknown>) => () => {
    setErr(null);
    f().catch(e => setErr(String(e)));
  };
  let kind = kindOf(g);
  let s = status(g, Date.now());
  let over = s.kind === "over";
  let maxStep = revealSteps(g.ns_moves);
  let saveWindow = run(() => {
    let w = Number(windowSecs);
    if (!(w > 0)) return Promise.reject("Vote time must be positive");
    return w === g.window_secs ? Promise.resolve() : api.settings(w, null);
  });
  let saveGap = run(() => {
    let gap = Number(gapSecs);
    if (!(gap >= 0)) return Promise.reject("Pause must be non-negative");
    return gap === g.gap_secs ? Promise.resolve() : api.settings(null, gap);
  });

  return (
    <aside className="controls">
      <section>
        <h2>Phase</h2>
        <div className="row">
          {PHASES.map(p => (
            <button
              key={p.phase}
              type="button"
              className={g.phase === p.phase ? "active" : ""}
              onClick={run(() => api.setPhase(p.phase))}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {kind && (
        <section>
          <h2>Game</h2>
          <div className="row">
            {g.paused ? (
              <button
                type="button"
                className="primary"
                disabled={over}
                onClick={run(api.play)}
              >
                ▶ Play
              </button>
            ) : (
              <button type="button" onClick={run(api.pause)}>
                ❚❚ Pause
              </button>
            )}
            <button
              type="button"
              disabled={movesOf(g, kind).length === 0}
              onClick={run(api.undo)}
            >
              ↶ Undo
            </button>
            <ConfirmButton onConfirm={run(api.restart)}>Restart</ConfirmButton>
          </div>
          <p className="hint">Space toggles play/pause.</p>
        </section>
      )}

      {g.phase === "reveal" && (
        <section>
          <h2>
            Reveal step {Math.min(g.reveal_step, maxStep)} / {maxStep}
          </h2>
          <div className="row">
            <button
              type="button"
              disabled={g.reveal_step <= 0}
              onClick={run(() => api.reveal(g.reveal_step - 1))}
            >
              ◀ Prev
            </button>
            <button
              type="button"
              className="primary"
              disabled={g.reveal_step >= maxStep}
              onClick={run(() => api.reveal(g.reveal_step + 1))}
            >
              Next ▶
            </button>
          </div>
          <p className="hint">Arrow keys step through the reveal.</p>
        </section>
      )}

      <section>
        <h2>Timing (seconds)</h2>
        <div className="row">
          <label>
            Vote
            <input
              type="number"
              min="1"
              step="0.5"
              value={windowSecs}
              onChange={e => setWindowSecs(e.target.value)}
              onBlur={saveWindow}
            />
          </label>
          <label>
            Pause between turns
            <input
              type="number"
              min="0"
              step="0.5"
              value={gapSecs}
              onChange={e => setGapSecs(e.target.value)}
              onBlur={saveGap}
            />
          </label>
        </div>
      </section>

      <section>
        <h2>Teams</h2>
        <div className="team-counts">
          {TEAMS.map(team => (
            <div key={team} className={`team-count ${team}`}>
              <span>{counts[team]}</span> {teamName(team)}
            </div>
          ))}
        </div>
        <div className="row">
          <ConfirmButton onConfirm={run(api.reshuffle)}>
            Reshuffle teams
          </ConfirmButton>
        </div>
      </section>

      <section>
        <h2>Reset</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={clearPlayers}
            onChange={e => setClearPlayers(e.target.checked)}
          />
          Also forget all players
        </label>
        <div className="row">
          <ConfirmButton
            className="danger"
            onConfirm={run(() => api.resetAll(clearPlayers))}
          >
            Reset everything
          </ConfirmButton>
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </section>

      {err && <div className="error">{err}</div>}
    </aside>
  );
};

let useHotkeys = (api: Admin, g: GameRow | null) => {
  let gRef = useRef(g);
  gRef.current = g;
  useEffect(() => {
    let onKey = (e: KeyboardEvent) => {
      let cur = gRef.current;
      if (!cur || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " " && kindOf(cur)) {
        e.preventDefault();
        (cur.paused ? api.play() : api.pause()).catch(console.error);
      } else if (cur.phase === "reveal" && e.key === "ArrowRight") {
        let max = revealSteps(cur.ns_moves);
        api.reveal(Math.min(max, cur.reveal_step + 1)).catch(console.error);
      } else if (cur.phase === "reveal" && e.key === "ArrowLeft") {
        api.reveal(Math.max(0, cur.reveal_step - 1)).catch(console.error);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);
};

let AdminPanel = ({
  secret,
  onLogout
}: {
  secret: string;
  onLogout: () => void;
}) => {
  let api = useRef(admin(secret)).current;
  let g = useGame();
  let offset = useClockOffset();
  let now = useNow(offset);
  let counts = useTeamCounts();
  useResolver(api, g, offset);
  useHotkeys(api, g);
  if (!g) return <div className="loading">Connecting…</div>;
  return (
    <div className="app admin">
      <main className="projector">
        <Projector g={g} now={now} counts={counts} />
      </main>
      <Controls api={api} g={g} counts={counts} onLogout={onLogout} />
    </div>
  );
};

let readSecret = () => {
  try {
    return sessionStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
};

let writeSecret = (s: string | null) => {
  try {
    if (s === null) sessionStorage.removeItem(SECRET_KEY);
    else sessionStorage.setItem(SECRET_KEY, s);
  } catch {}
};

export let AdminApp = () => {
  let [secret, setSecret] = useState<string | null>(readSecret);
  let [input, setInput] = useState("");
  let [err, setErr] = useState<string | null>(null);
  if (secret)
    return (
      <AdminPanel
        secret={secret}
        onLogout={() => {
          writeSecret(null);
          setSecret(null);
        }}
      />
    );
  let login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      if (await admin(input).check()) {
        writeSecret(input);
        setSecret(input);
      } else setErr("Wrong passphrase.");
    } catch (e) {
      setErr(String(e));
    }
  };
  return (
    <form className="login" onSubmit={login}>
      <h1>Instructor login</h1>
      <input
        type="password"
        placeholder="Passphrase"
        value={input}
        onChange={e => setInput(e.target.value)}
      />
      <button type="submit" className="primary">
        Enter
      </button>
      {err && <div className="error">{err}</div>}
    </form>
  );
};
