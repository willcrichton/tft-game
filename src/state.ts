import {
  type GameKind,
  legalMoves,
  type Outcome,
  outcome,
  type Phase,
  type Result,
  type Team,
  teamOfMove,
  turnTeam
} from "./logic";

export interface GameRow {
  phase: Phase;
  ns_moves: number[];
  ttt_moves: number[];
  ns_result: Result | null;
  ttt_result: Result | null;
  round: number;
  round_starts_at: string | null;
  round_ends_at: string | null;
  paused: boolean;
  window_secs: number;
  gap_secs: number;
  team_epoch: number;
}

export const INITIAL: GameRow = {
  phase: "lobby",
  ns_moves: [],
  ttt_moves: [],
  ns_result: null,
  ttt_result: null,
  round: 0,
  round_starts_at: null,
  round_ends_at: null,
  paused: true,
  window_secs: 5,
  gap_secs: 2,
  team_epoch: 0
};

let intArray = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    let inner = v.replace(/^\{|\}$/g, "").trim();
    return inner === "" ? [] : inner.split(",").map(Number);
  }
  return [];
};

export let normalizeRow = (row: Record<string, unknown>): GameRow =>
  ({
    ...row,
    ns_moves: intArray(row.ns_moves),
    ttt_moves: intArray(row.ttt_moves),
    round: Number(row.round),
    window_secs: Number(row.window_secs),
    gap_secs: Number(row.gap_secs),
    team_epoch: Number(row.team_epoch)
  }) as GameRow;

export let newerRow = (prev: GameRow | null, next: GameRow): GameRow =>
  prev && next.round < prev.round ? prev : next;

export interface TallyMsg {
  round: number;
  counts: [number, number][];
}

export let teamTally = (
  g: GameRow,
  now: number,
  myTeam: Team | null,
  msg: TallyMsg | null
): Map<number, number> | undefined => {
  let s = status(g, now);
  if (s.kind !== "open" && s.kind !== "closing") return undefined;
  if (s.team !== myTeam || msg?.round !== g.round) return undefined;
  return new Map(msg.counts);
};

export const VOTE_GRACE_MS = 300;

export let kindOf = (g: GameRow): GameKind | null =>
  g.phase === "ns" || g.phase === "ttt" ? g.phase : null;

export let movesOf = (g: GameRow, kind: GameKind): number[] =>
  kind === "ns" ? g.ns_moves : g.ttt_moves;

export let resultOf = (g: GameRow, kind: GameKind): Result | null =>
  kind === "ns" ? g.ns_result : g.ttt_result;

export interface LastMove {
  team: Team;
  move: number;
}

export type Status =
  | { kind: "idle" }
  | { kind: "over"; result: Result; outcome: Outcome }
  | { kind: "paused"; team: Team }
  | { kind: "gap"; team: Team; msLeft: number; last: LastMove | null }
  | { kind: "open"; team: Team; msLeft: number; total: number }
  | { kind: "closing"; team: Team };

export let lastMove = (moves: number[]): LastMove | null =>
  moves.length === 0
    ? null
    : { team: teamOfMove(moves.length - 1), move: moves[moves.length - 1] };

export let status = (g: GameRow, now: number): Status => {
  let kind = kindOf(g);
  if (!kind) return { kind: "idle" };
  let moves = movesOf(g, kind);
  let result = resultOf(g, kind);
  if (result) return { kind: "over", result, outcome: outcome(kind, moves) };
  let team = turnTeam(moves);
  if (g.paused || !g.round_starts_at || !g.round_ends_at)
    return { kind: "paused", team };
  let start = Date.parse(g.round_starts_at);
  let end = Date.parse(g.round_ends_at);
  if (now < start)
    return { kind: "gap", team, msLeft: start - now, last: lastMove(moves) };
  if (now < end)
    return { kind: "open", team, msLeft: end - now, total: end - start };
  return { kind: "closing", team };
};

export let shouldResolve = (g: GameRow, now: number): boolean =>
  status(g, now).kind === "closing" &&
  now >= Date.parse(g.round_ends_at!) + VOTE_GRACE_MS;

export let canVote = (g: GameRow, now: number, team: Team | null): boolean => {
  let s = status(g, now);
  return s.kind === "open" && s.team === team;
};

export let legalFor = (g: GameRow): number[] => {
  let kind = kindOf(g);
  return kind ? legalMoves(kind, movesOf(g, kind)) : [];
};
