import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  type GameKind,
  legalMoves,
  outcome,
  pickMove,
  type Team,
  turnTeam
} from "../src/logic.ts";

let url = process.env.VITE_SUPABASE_URL!;
let key = process.env.VITE_SUPABASE_ANON_KEY!;
let secret = readFileSync(".admin-passphrase", "utf8").trim();
let sb = createClient(url, key, { auth: { persistSession: false } });

let rpc = async <T>(fn: string, args: Record<string, unknown> = {}) => {
  let { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
};
let adm = (fn: string, args: Record<string, unknown> = {}) =>
  rpc(`admin_${fn}`, { p_secret: secret, ...args });

let check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok  ${msg}`);
};

let sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Row {
  phase: string;
  ns_moves: number[];
  ttt_moves: number[];
  ns_result: string | null;
  ttt_result: string | null;
  round: number;
  paused: boolean;
  round_starts_at: string | null;
  round_ends_at: string | null;
}

let fetchRow = async (): Promise<Row> => {
  let { data, error } = await sb.from("game").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as Row;
};

let realtimeEvents: Row[] = [];
let channel = sb
  .channel("smoke")
  .on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "game" },
    p => realtimeEvents.push(p.new as Row)
  );
await new Promise<void>((resolve, reject) => {
  channel.subscribe(s => {
    if (s === "SUBSCRIBED") resolve();
    if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") reject(new Error(s));
  });
});
await sleep(1500);
console.log("realtime subscribed");

check(
  (await rpc<boolean>("admin_check", { p_secret: "nope" })) === false,
  "wrong passphrase rejected"
);
check(
  (await rpc<boolean>("admin_check", { p_secret: secret })) === true,
  "passphrase accepted"
);

await adm("reset_all", { p_clear_players: true });
await adm("settings", { p_window_secs: 1.5, p_gap_secs: 0.3 });
await sleep(2000);
let total = (c: Record<Team, number>) => c.red + c.blue;
let baseline = total(await rpc<Record<Team, number>>("team_counts"));
if (baseline > 0)
  console.log(`  (${baseline} other connected players present)`);

let students: { id: string; team: Team }[] = [];
for (let i = 0; i < 6; i++) {
  let id = randomUUID();
  students.push({ id, team: await rpc<Team>("join_game", { p_player: id }) });
}
let counts = await rpc<Record<Team, number>>("team_counts");
check(
  total(counts) === baseline + 6 && Math.abs(counts.red - counts.blue) <= 1,
  `teams balanced ${JSON.stringify(counts)}`
);

await rpc("leave_game", { p_player: students[0].id });
let afterLeave = await rpc<Record<Team, number>>("team_counts");
check(total(afterLeave) === baseline + 5, "leaving drops the count");
check(
  (await rpc<Team>("join_game", { p_player: students[0].id })) ===
    students[0].team,
  "rejoining keeps the same team"
);
let afterRejoin = await rpc<Record<Team, number>>("team_counts");
check(total(afterRejoin) === baseline + 6, "rejoining restores the count");

let play = async (kind: GameKind, plan: number[]) => {
  await adm("set_phase", { p_phase: kind });
  await adm("restart");
  await adm("play");
  let moveIdx = 0;
  let wrongTeamChecked = false;
  while (true) {
    let g = await fetchRow();
    let moves = kind === "ns" ? g.ns_moves : g.ttt_moves;
    let result = kind === "ns" ? g.ns_result : g.ttt_result;
    if (result) return { g, moves, result };
    let now = Date.parse(await rpc<string>("server_now"));
    let start = Date.parse(g.round_starts_at!);
    let end = Date.parse(g.round_ends_at!);
    if (now < start) {
      await sleep(start - now + 50);
      continue;
    }
    let team = turnTeam(moves);
    let mine = students.filter(s => s.team === team);
    let legal = legalMoves(kind, moves);
    let target = plan[moves.length];
    let decoy = legal.find(m => m !== target)!;
    if (moveIdx === moves.length) {
      let votes = mine.map((_, i) =>
        mine.length > 2 && i === mine.length - 1 ? decoy : target
      );
      let results = await Promise.all(
        mine.map((s, i) =>
          rpc<string>("cast_vote", {
            p_player: s.id,
            p_round: g.round,
            p_choice: votes[i]
          })
        )
      );
      check(
        results.every(r => r === "ok"),
        `${kind} move ${moves.length + 1}: ${team} votes accepted`
      );
      if (!wrongTeamChecked) {
        let other = students.find(s => s.team !== team)!;
        let r = await rpc<string>("cast_vote", {
          p_player: other.id,
          p_round: g.round,
          p_choice: target
        });
        check(r === "not_your_turn", "off-turn vote rejected");
        wrongTeamChecked = true;
      }
      moveIdx++;
    }
    now = Date.parse(await rpc<string>("server_now"));
    if (now < end + 350) {
      await sleep(end + 350 - now);
      continue;
    }
    let late = await rpc<string>("cast_vote", {
      p_player: mine[0].id,
      p_round: g.round,
      p_choice: target
    });
    check(
      late === "closed" || late === "not_playing",
      `late vote rejected (${late})`
    );
    let { data } = await sb.from("votes").select("choice").eq("round", g.round);
    let choice = pickMove(
      data!.map(v => v.choice as number),
      legal
    );
    check(choice === target, `plurality picks ${target}`);
    let applied = await adm("apply", {
      p_round: g.round,
      p_choice: choice,
      p_result: outcome(kind, [...moves, choice]).result
    });
    let after = await fetchRow();
    let afterMoves = kind === "ns" ? after.ns_moves : after.ttt_moves;
    check(
      afterMoves.length === moves.length + 1 &&
        afterMoves[moves.length] === target,
      applied ? "move applied" : "move applied (by an open admin tab)"
    );
    let stale = await adm("apply", {
      p_round: g.round,
      p_choice: decoy,
      p_result: null
    });
    check(stale === false, "stale apply rejected");
  }
};

console.log("Pick 15");
let ns = await play("ns", [2, 1, 6, 3, 7]);
check(
  JSON.stringify(ns.moves) === "[2,1,6,3,7]" && ns.result === "red",
  "red wins Pick 15 with 2,6,7"
);

console.log("Tic-tac-toe");
let ttt = await play("ttt", [0, 3, 1, 4, 2]);
check(
  JSON.stringify(ttt.moves) === "[0,3,1,4,2]" && ttt.result === "red",
  "red wins tic-tac-toe top row"
);

await adm("set_phase", { p_phase: "reveal" });
check((await fetchRow()).phase === "reveal", "reveal phase");

await sleep(1000);
let finalEvent = realtimeEvents[realtimeEvents.length - 1];
let rounds = [...new Set(realtimeEvents.map(e => e.round))];
let gaps = rounds.slice(1).filter((r, i) => r !== rounds[i] + 1);
check(
  realtimeEvents.length >= 19 && gaps.length === 0,
  `realtime delivered ${realtimeEvents.length} updates, rounds contiguous`
);
check(
  finalEvent?.phase === "reveal" && Array.isArray(finalEvent.ns_moves),
  "realtime payload has phase and int[] arrays"
);

if (!process.argv.includes("--keep")) {
  await adm("reset_all", { p_clear_players: true });
  await adm("settings", { p_window_secs: 5, p_gap_secs: 2 });
  console.log("reset to lobby");
}
await sb.removeChannel(channel);
console.log("SMOKE PASSED");
process.exit(0);
