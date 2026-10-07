import { describe, expect, test } from "vitest";
import {
  canVote,
  type GameRow,
  INITIAL,
  legalFor,
  newerRow,
  normalizeRow,
  shouldResolve,
  status,
  teamTally,
  VOTE_GRACE_MS
} from "../src/state";

let T0 = Date.parse("2026-10-07T12:00:00Z");
let iso = (ms: number) => new Date(ms).toISOString();

let running = (over: Partial<GameRow> = {}): GameRow => ({
  ...INITIAL,
  phase: "ns",
  paused: false,
  round_starts_at: iso(T0),
  round_ends_at: iso(T0 + 5000),
  ...over
});

describe("status", () => {
  test("lobby and reveal are idle", () => {
    expect(status(INITIAL, T0).kind).toBe("idle");
    expect(status({ ...INITIAL, phase: "reveal" }, T0).kind).toBe("idle");
  });

  test("paused game reports whose turn it is", () => {
    expect(status({ ...INITIAL, phase: "ttt", ttt_moves: [4] }, T0)).toEqual({
      kind: "paused",
      team: "blue"
    });
  });

  test("gap before window shows last move", () => {
    let g = running({ ns_moves: [7], round_starts_at: iso(T0 + 1000) });
    expect(status(g, T0)).toEqual({
      kind: "gap",
      team: "blue",
      msLeft: 1000,
      last: { team: "red", move: 7 }
    });
  });

  test("open window counts down", () => {
    expect(status(running(), T0 + 2000)).toEqual({
      kind: "open",
      team: "red",
      msLeft: 3000,
      total: 5000
    });
  });

  test("closing after the window", () => {
    expect(status(running(), T0 + 5000).kind).toBe("closing");
  });

  test("over when result set, with winning triple", () => {
    let g = running({ ns_moves: [2, 1, 6, 3, 7], ns_result: "red" });
    let s = status(g, T0);
    expect(s.kind).toBe("over");
    if (s.kind === "over") expect(s.outcome.winning).toEqual([2, 6, 7]);
  });

  test("result is per-game, so ttt is unaffected by ns result", () => {
    let g = running({ phase: "ttt", ns_result: "red" });
    expect(status(g, T0 + 1).kind).toBe("open");
  });
});

describe("voting gates", () => {
  test("only the current team during the open window", () => {
    expect(canVote(running(), T0 + 1, "red")).toBe(true);
    expect(canVote(running(), T0 + 1, "blue")).toBe(false);
    expect(canVote(running(), T0 + 6000, "red")).toBe(false);
    expect(canVote(running(), T0 + 1, null)).toBe(false);
  });

  test("resolve waits for the grace period", () => {
    expect(shouldResolve(running(), T0 + 5000)).toBe(false);
    expect(shouldResolve(running(), T0 + 5000 + VOTE_GRACE_MS)).toBe(true);
    expect(
      shouldResolve(running({ paused: true }), T0 + 9000 + VOTE_GRACE_MS)
    ).toBe(false);
  });

  test("legal moves follow the phase", () => {
    expect(legalFor(running({ ns_moves: [1, 2, 3] }))).toEqual([
      4, 5, 6, 7, 8, 9
    ]);
    expect(legalFor(INITIAL)).toEqual([]);
  });
});

describe("normalizeRow", () => {
  test("accepts JSON arrays and Postgres array literals", () => {
    let g = normalizeRow({
      ...INITIAL,
      ns_moves: "{5,2,8}",
      ttt_moves: "{}",
      window_secs: "4.5",
      round: "7"
    });
    expect(g.ns_moves).toEqual([5, 2, 8]);
    expect(g.ttt_moves).toEqual([]);
    expect(g.window_secs).toBe(4.5);
    expect(g.round).toBe(7);
    expect(normalizeRow({ ...INITIAL, ns_moves: [1, 2] }).ns_moves).toEqual([
      1, 2
    ]);
  });
});

describe("newerRow", () => {
  test("ignores rows from an older round", () => {
    let a = { ...INITIAL, round: 5 };
    let b = { ...INITIAL, round: 4 };
    let c = { ...INITIAL, round: 5, paused: false };
    expect(newerRow(a, b)).toBe(a);
    expect(newerRow(a, c)).toBe(c);
    expect(newerRow(null, b)).toBe(b);
  });
});

describe("teamTally", () => {
  let msg = (round: number) => ({
    round,
    counts: [
      [5, 3],
      [2, 1]
    ] as [number, number][]
  });

  test("voting team sees its tally during the window", () => {
    expect(teamTally(running(), T0 + 1, "red", msg(0))).toEqual(
      new Map([
        [5, 3],
        [2, 1]
      ])
    );
  });

  test("still visible while votes are being counted", () => {
    expect(teamTally(running(), T0 + 5100, "red", msg(0))).toBeDefined();
  });

  test("other team, spectators, stale rounds and gaps see nothing", () => {
    expect(teamTally(running(), T0 + 1, "blue", msg(0))).toBeUndefined();
    expect(teamTally(running(), T0 + 1, null, msg(0))).toBeUndefined();
    expect(teamTally(running(), T0 + 1, "red", msg(1))).toBeUndefined();
    expect(teamTally(running(), T0 + 1, "red", null)).toBeUndefined();
    let gap = running({ round_starts_at: iso(T0 + 1000) });
    expect(teamTally(gap, T0, "blue", msg(0))).toBeUndefined();
  });
});
