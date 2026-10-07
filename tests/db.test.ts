// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { GameRow } from "../src/state";

let SECRET = "hunter2";
let SCHEMA = readFileSync("supabase/schema.sql", "utf8");

describe.each([
  ["default grants", true],
  ["no default grants", false]
])("database (%s)", (_, defaultGrants) => {
  let db: PGlite;
  let anon = {
    query: (sql: string, params?: unknown[]) =>
      db.query<Record<string, unknown>>(sql, params)
  };
  let asSuper = async <T>(f: () => Promise<T>): Promise<T> => {
    await db.exec("reset role");
    try {
      return await f();
    } finally {
      await db.exec("set role anon");
    }
  };

  let call = async (fn: string, ...args: unknown[]) => {
    let params = args.map((_, i) => `$${i + 1}`).join(", ");
    let res = await anon.query(`select public.${fn}(${params}) as v`, args);
    return res.rows[0].v;
  };
  let game = async () =>
    (await anon.query("select * from game where id = 1")).rows[0] as GameRow;
  let teamCounts = async () =>
    (await call("team_counts")) as { red: number; blue: number };
  let join = async () => {
    let id = randomUUID();
    return { id, team: (await call("join_game", id)) as string };
  };
  let joinTeams = async () => {
    let a = await join();
    let b = await join();
    return a.team === "red" ? { red: a, blue: b } : { red: b, blue: a };
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create publication supabase_realtime;
    `);
    if (defaultGrants)
      await db.exec(`
        grant usage on schema public to anon, authenticated;
        alter default privileges in schema public grant all on tables to anon, authenticated;
      `);
    await db.exec(SCHEMA);
    await db.exec(SCHEMA);
    await db.exec(`insert into admin_config (secret) values ('${SECRET}')`);
    await db.exec("set role anon");
  }, 60_000);

  beforeEach(async () => {
    await call("admin_reset_all", SECRET, true);
    await call("admin_settings", SECRET, 5, 0);
  });

  test("join_game balances teams and is idempotent", async () => {
    let ps = await Promise.all([join(), join(), join(), join()]);
    let reds = ps.filter(p => p.team === "red").length;
    expect(reds).toBe(2);
    expect(await call("join_game", ps[0].id)).toBe(ps[0].team);
    expect(await teamCounts()).toEqual({ red: 2, blue: 2 });
  });

  let disconnect = (id: string) =>
    asSuper(() =>
      anon.query(
        "update players set last_seen = now() - interval '5 minutes' where id = $1",
        [id]
      )
    );

  test("team counts only include connected players", async () => {
    let { red, blue } = await joinTeams();
    await disconnect(blue.id);
    expect(await teamCounts()).toEqual({ red: 1, blue: 0 });
    await call("leave_game", red.id);
    expect(await teamCounts()).toEqual({ red: 0, blue: 0 });
  });

  test("new players balance against connected players only", async () => {
    let { red, blue } = await joinTeams();
    await disconnect(blue.id);
    expect((await join()).team).toBe("blue");
    await disconnect(red.id);
    let { blue: b2 } = await joinTeams();
    await disconnect(b2.id);
    expect(await teamCounts()).toEqual({ red: 1, blue: 1 });
  });

  test("returning players keep their team and count again", async () => {
    let { red, blue } = await joinTeams();
    await call("leave_game", red.id);
    await disconnect(blue.id);
    for (let i = 0; i < 3; i++) await join();
    expect(await call("join_game", red.id)).toBe("red");
    expect(await call("join_game", blue.id)).toBe("blue");
    let counts = await teamCounts();
    expect(counts.red + counts.blue).toBe(5);
  });

  test("reshuffle leaves disconnected players alone", async () => {
    let ps = await Promise.all([join(), join(), join(), join(), join()]);
    let gone = ps.slice(0, 3);
    for (let p of gone) await disconnect(p.id);
    let before = await asSuper(() =>
      anon.query("select id, team from players order by id")
    );
    for (let i = 0; i < 5; i++) await call("admin_reshuffle", SECRET);
    let after = await asSuper(() =>
      anon.query("select id, team from players order by id")
    );
    let teamOf = (rows: Record<string, unknown>[], id: string) =>
      rows.find(r => r.id === id)?.team;
    for (let p of gone)
      expect(teamOf(after.rows, p.id)).toBe(teamOf(before.rows, p.id));
    expect(await teamCounts()).toEqual({ red: 1, blue: 1 });
  });

  test("anon cannot write tables directly or read secrets", async () => {
    await expect(
      anon.query("update game set phase = 'reveal' where id = 1")
    ).rejects.toThrow();
    await expect(anon.query("select * from admin_config")).rejects.toThrow();
    let { red } = await joinTeams();
    await expect(
      anon.query(
        "insert into votes (round, player_id, choice) values (1, $1, 5)",
        [red.id]
      )
    ).rejects.toThrow();
    let visible = await anon.query("select * from players").then(
      r => r.rows.length,
      () => 0
    );
    expect(visible).toBe(0);
  });

  test("admin functions require the secret", async () => {
    expect(await call("admin_check", SECRET)).toBe(true);
    expect(await call("admin_check", "nope")).toBe(false);
    await expect(call("admin_set_phase", "nope", "ns")).rejects.toThrow(
      /unauthorized/
    );
    await expect(call("assert_admin", SECRET)).rejects.toThrow();
  });

  test("voting is gated by phase, window, team and legality", async () => {
    let { red, blue } = await joinTeams();
    expect(await call("cast_vote", red.id, 0, 5)).toBe("not_playing");
    await call("admin_set_phase", SECRET, "ns");
    let g = await game();
    expect(await call("cast_vote", red.id, g.round, 5)).toBe("closed");
    await call("admin_play", SECRET);
    g = await game();
    expect(g.paused).toBe(false);
    expect(await call("cast_vote", red.id, g.round - 1, 5)).toBe("closed");
    expect(await call("cast_vote", blue.id, g.round, 5)).toBe("not_your_turn");
    expect(await call("cast_vote", red.id, g.round, 0)).toBe("illegal");
    expect(await call("cast_vote", randomUUID(), g.round, 5)).toBe(
      "unknown_player"
    );
    expect(await call("cast_vote", red.id, g.round, 5)).toBe("ok");
    expect(await call("cast_vote", red.id, g.round, 7)).toBe("ok");
    let votes = await anon.query("select choice from votes where round = $1", [
      g.round
    ]);
    expect(votes.rows).toEqual([{ choice: 7 }]);
  });

  test("admin_apply appends a move, flips turn, and rejects stale rounds", async () => {
    let { red, blue } = await joinTeams();
    await call("admin_set_phase", SECRET, "ns");
    await call("admin_play", SECRET);
    let g = await game();
    expect(await call("admin_apply", SECRET, g.round - 1, 5, null)).toBe(false);
    expect(await call("admin_apply", SECRET, g.round, 5, null)).toBe(true);
    expect(await call("admin_apply", SECRET, g.round, 6, null)).toBe(false);
    g = await game();
    expect(g.ns_moves).toEqual([5]);
    expect(g.paused).toBe(false);
    expect(await call("cast_vote", red.id, g.round, 4)).toBe("not_your_turn");
    expect(await call("cast_vote", blue.id, g.round, 5)).toBe("illegal");
    expect(await call("cast_vote", blue.id, g.round, 4)).toBe("ok");
  });

  test("gap delays the next window", async () => {
    let { blue } = await joinTeams();
    await call("admin_settings", SECRET, 5, 10);
    await call("admin_set_phase", SECRET, "ttt");
    await call("admin_play", SECRET);
    let g = await game();
    await call("admin_apply", SECRET, g.round, 4, null);
    g = await game();
    expect(await call("cast_vote", blue.id, g.round, 0)).toBe("closed");
  });

  test("a result ends the game and blocks votes and play", async () => {
    let { red } = await joinTeams();
    await call("admin_set_phase", SECRET, "ttt");
    await call("admin_play", SECRET);
    let g = await game();
    await call("admin_apply", SECRET, g.round, 4, "red");
    g = await game();
    expect(g.ttt_result).toBe("red");
    expect(g.paused).toBe(true);
    expect(await call("cast_vote", red.id, g.round, 0)).toBe("not_playing");
    await call("admin_play", SECRET);
    expect((await game()).paused).toBe(true);
  });

  test("undo pops the last move of the current game only", async () => {
    await call("admin_set_phase", SECRET, "ns");
    await call("admin_play", SECRET);
    await call("admin_apply", SECRET, (await game()).round, 5, null);
    await call("admin_apply", SECRET, (await game()).round, 2, "blue");
    await call("admin_set_phase", SECRET, "ttt");
    await call("admin_undo", SECRET);
    let g = await game();
    expect(g.ns_moves).toEqual([5, 2]);
    expect(g.ttt_moves).toEqual([]);
    await call("admin_set_phase", SECRET, "ns");
    await call("admin_undo", SECRET);
    g = await game();
    expect(g.ns_moves).toEqual([5]);
    expect(g.ns_result).toBeNull();
    expect(g.paused).toBe(true);
  });

  test("restart clears only the current game", async () => {
    await call("admin_set_phase", SECRET, "ns");
    await call("admin_play", SECRET);
    await call("admin_apply", SECRET, (await game()).round, 5, null);
    await call("admin_set_phase", SECRET, "ttt");
    await call("admin_play", SECRET);
    await call("admin_apply", SECRET, (await game()).round, 4, null);
    await call("admin_restart", SECRET);
    let g = await game();
    expect(g.ns_moves).toEqual([5]);
    expect(g.ttt_moves).toEqual([]);
  });

  test("reshuffle keeps teams balanced and bumps epoch", async () => {
    await Promise.all([join(), join(), join(), join(), join()]);
    let before = (await game()).team_epoch;
    await call("admin_reshuffle", SECRET);
    let counts = await teamCounts();
    expect(Math.abs(counts.red - counts.blue)).toBe(1);
    expect((await game()).team_epoch).toBe(before + 1);
  });

  test("settings update only the fields given", async () => {
    await call("admin_settings", SECRET, 3, 1);
    await call("admin_settings", SECRET, null, 0.5);
    let g = await game();
    expect([Number(g.window_secs), Number(g.gap_secs)]).toEqual([3, 0.5]);
    await call("admin_settings", SECRET, 4, null);
    g = await game();
    expect([Number(g.window_secs), Number(g.gap_secs)]).toEqual([4, 0.5]);
  });

  test("reset_all returns to lobby", async () => {
    await join();
    await call("admin_set_phase", SECRET, "reveal");
    await call("admin_reveal", SECRET, 3);
    await call("admin_reset_all", SECRET, false);
    let g = await game();
    expect(g.phase).toBe("lobby");
    expect(g.reveal_step).toBe(0);
    let counts = await teamCounts();
    expect(counts.red + counts.blue).toBe(1);
    let total = await asSuper(() =>
      anon.query("select count(*)::int as n from players")
    );
    expect(total.rows[0].n).toBe(1);
  });
});
