import { useEffect, useRef, useState } from "react";
import {
  fetchGame,
  joinGame,
  leaveGame,
  serverNow,
  subscribeGame
} from "./api";
import type { Team } from "./logic";
import { type GameRow, newerRow } from "./state";

const POLL_MS = 10_000;
const SETTLE_MS = 1500;
const HEARTBEAT_MS = 20_000;

export let useGame = (): GameRow | null => {
  let [row, setRow] = useState<GameRow | null>(null);
  useEffect(() => {
    let alive = true;
    let accept = (r: GameRow) => alive && setRow(prev => newerRow(prev, r));
    let refresh = () => fetchGame().then(accept).catch(console.error);
    let settle: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = subscribeGame(accept, () => {
      refresh();
      clearTimeout(settle);
      settle = setTimeout(refresh, SETTLE_MS);
    });
    let poll = setInterval(refresh, POLL_MS);
    let onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    refresh();
    return () => {
      alive = false;
      unsubscribe();
      clearInterval(poll);
      clearTimeout(settle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return row;
};

export let useClockOffset = (): number => {
  let [offset, setOffset] = useState(0);
  useEffect(() => {
    let best = { rtt: Infinity, offset: 0 };
    let sample = async () => {
      let t0 = Date.now();
      let server = Date.parse(await serverNow());
      let t1 = Date.now();
      if (t1 - t0 < best.rtt) {
        best = { rtt: t1 - t0, offset: server - (t0 + t1) / 2 };
        setOffset(best.offset);
      }
    };
    (async () => {
      for (let i = 0; i < 4; i++) await sample().catch(console.error);
    })();
  }, []);
  return offset;
};

export let useNow = (offset: number, intervalMs = 100): number => {
  let [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    let id = setInterval(() => setNow(Date.now() + offset), intervalMs);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
};

const PLAYER_KEY = "tft-player-id";

let playerId = (): string => {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (id) return id;
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

export let usePlayer = (
  epoch: number | undefined
): { id: string; team: Team | null } => {
  let id = useRef(playerId()).current;
  let [team, setTeam] = useState<Team | null>(null);
  useEffect(() => {
    if (epoch === undefined) return;
    let join = () => joinGame(id).then(setTeam).catch(console.error);
    let onVisible = () => document.visibilityState === "visible" && join();
    let onHide = () => leaveGame(id).catch(() => {});
    join();
    let beat = setInterval(join, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", join);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", join);
      window.removeEventListener("pagehide", onHide);
    };
  }, [id, epoch]);
  return { id, team };
};
