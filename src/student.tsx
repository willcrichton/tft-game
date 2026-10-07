import React, { useState } from "react";
import { castVote } from "./api";
import { GameScreen, Lobby, RevealScreen, TeamBanner } from "./components";
import {
  useClockOffset,
  useGame,
  useNow,
  usePlayer,
  useTallyFeed
} from "./hooks";
import { teamTally } from "./state";

const VOTE_ERRORS: Record<string, string> = {
  closed: "Too late, voting is closed.",
  not_your_turn: "It's not your team's turn.",
  illegal: "That move isn't available.",
  not_playing: "The game isn't running.",
  unknown_player: "You're not on a team yet. Try refreshing."
};

export let Student = () => {
  let g = useGame();
  let now = useNow(useClockOffset());
  let { id, team } = usePlayer(g?.team_epoch);
  let [vote, setVote] = useState<{ round: number; move: number } | null>(null);
  let [error, setError] = useState<string | null>(null);
  let tallyMsg = useTallyFeed();

  if (!g) return <div className="loading">Connecting…</div>;

  let myVote = vote?.round === g.round ? vote.move : null;
  let onPick = async (move: number) => {
    let round = g.round;
    setVote({ round, move });
    setError(null);
    try {
      let r = await castVote(id, round, move);
      if (r !== "ok") {
        setError(VOTE_ERRORS[r] ?? r);
        setVote(v => (v?.round === round && v.move === move ? null : v));
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className={`app student ${team ?? ""}`}>
      <TeamBanner team={team} />
      <main>
        {g.phase === "lobby" && <Lobby myTeam={team} />}
        {(g.phase === "ns" || g.phase === "ttt") && (
          <GameScreen
            g={g}
            now={now}
            myTeam={team}
            myVote={myVote}
            tally={teamTally(g, now, team, tallyMsg)}
            onPick={onPick}
          />
        )}
        {g.phase === "reveal" && <RevealScreen g={g} />}
        {error && <div className="error">{error}</div>}
      </main>
    </div>
  );
};
