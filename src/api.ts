import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Result, Team } from "./logic";
import { type GameRow, normalizeRow } from "./state";

let client: SupabaseClient | null = null;

export let supabase = (): SupabaseClient => {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  return client;
};

let rpc = async <T>(fn: string, args: Record<string, unknown> = {}) => {
  let { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
};

export let fetchGame = async (): Promise<GameRow> => {
  let { data, error } = await supabase()
    .from("game")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`fetchGame: ${error.message}`);
  return normalizeRow(data);
};

export let subscribeGame = (
  onRow: (row: GameRow) => void,
  onSubscribed: () => void
) => {
  let channel = supabase()
    .channel("game")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "game" },
      payload => onRow(normalizeRow(payload.new))
    )
    .subscribe(s => {
      if (s === "SUBSCRIBED") onSubscribed();
    });
  return () => {
    supabase().removeChannel(channel);
  };
};

export let fetchVotes = async (round: number): Promise<number[]> => {
  let { data, error } = await supabase()
    .from("votes")
    .select("choice")
    .eq("round", round);
  if (error) throw new Error(`fetchVotes: ${error.message}`);
  return (data as { choice: number }[]).map(v => v.choice);
};

export let serverNow = () => rpc<string>("server_now");
export let joinGame = (player: string) =>
  rpc<Team>("join_game", { p_player: player });
export let teamCounts = () => rpc<Record<Team, number>>("team_counts");
export let castVote = (player: string, round: number, choice: number) =>
  rpc<string>("cast_vote", {
    p_player: player,
    p_round: round,
    p_choice: choice
  });

export let admin = (secret: string) => ({
  check: () => rpc<boolean>("admin_check", { p_secret: secret }),
  setPhase: (phase: GameRow["phase"]) =>
    rpc<void>("admin_set_phase", { p_secret: secret, p_phase: phase }),
  play: () => rpc<void>("admin_play", { p_secret: secret }),
  pause: () => rpc<void>("admin_pause", { p_secret: secret }),
  apply: (round: number, choice: number, result: Result | null) =>
    rpc<boolean>("admin_apply", {
      p_secret: secret,
      p_round: round,
      p_choice: choice,
      p_result: result
    }),
  undo: () => rpc<void>("admin_undo", { p_secret: secret }),
  restart: () => rpc<void>("admin_restart", { p_secret: secret }),
  settings: (windowSecs: number | null, gapSecs: number | null) =>
    rpc<void>("admin_settings", {
      p_secret: secret,
      p_window_secs: windowSecs,
      p_gap_secs: gapSecs
    }),
  reveal: (step: number) =>
    rpc<void>("admin_reveal", { p_secret: secret, p_step: step }),
  reshuffle: () => rpc<void>("admin_reshuffle", { p_secret: secret }),
  resetAll: (clearPlayers: boolean) =>
    rpc<void>("admin_reset_all", {
      p_secret: secret,
      p_clear_players: clearPlayers
    })
});

export type Admin = ReturnType<typeof admin>;
