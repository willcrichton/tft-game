import React from "react";
import {
  type GameKind,
  MAGIC,
  outcome,
  type Result,
  type Team,
  teamOfMove
} from "./logic";
import {
  type GameRow,
  kindOf,
  legalFor,
  movesOf,
  type Status,
  status
} from "./state";

export let teamName = (t: Team) => (t === "red" ? "Red" : "Blue");

let ownersOf = (moves: number[]): Map<number, Team> =>
  new Map(moves.map((m, i) => [m, teamOfMove(i)]));

export interface PickProps {
  pickable?: boolean;
  legal?: number[];
  myVote?: number | null;
  tally?: Map<number, number>;
  onPick?: (move: number) => void;
}

interface TileProps extends PickProps {
  move: number;
  owner: Team | undefined;
  winning: boolean;
  last: boolean;
  className: string;
  children: React.ReactNode;
}

let Tile = ({
  move,
  owner,
  winning,
  last,
  pickable,
  legal,
  myVote,
  tally,
  onPick,
  className,
  children
}: TileProps) => {
  let enabled = !!pickable && !!legal?.includes(move);
  let count = tally?.get(move) ?? 0;
  let max = tally ? Math.max(1, ...tally.values()) : 1;
  let classes = [
    className,
    owner ?? "",
    winning ? "winning" : "",
    last ? "last" : "",
    myVote === move ? "voted" : "",
    enabled ? "enabled" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      disabled={!enabled}
      data-move={move}
      onClick={() => enabled && onPick?.(move)}
    >
      {children}
      {tally && count > 0 && (
        <span
          className="tally"
          style={{ "--share": count / max } as React.CSSProperties}
        >
          <span className="tally-count">{count}</span>
        </span>
      )}
    </button>
  );
};

export interface StripProps extends PickProps {
  moves: number[];
  winning?: number[] | null;
  last?: number | null;
}

export let NumberStrip = ({ moves, winning, last, ...pick }: StripProps) => {
  let owners = ownersOf(moves);
  return (
    <div className="strip" data-testid="strip">
      {MAGIC.slice()
        .sort((a, b) => a - b)
        .map(n => (
          <Tile
            key={n}
            move={n}
            owner={owners.get(n)}
            winning={!!winning?.includes(n)}
            last={last === n}
            className="num"
            {...pick}
          >
            <span className="num-label">{n}</span>
          </Tile>
        ))}
    </div>
  );
};

export interface BoardProps extends PickProps {
  cells: number[];
  overlay?: boolean;
  winning?: number[] | null;
  last?: number | null;
}

export let Board = ({ cells, overlay, winning, last, ...pick }: BoardProps) => {
  let owners = ownersOf(cells);
  return (
    <div className="board" data-testid="board">
      {MAGIC.map((magic, cell) => {
        let owner = owners.get(cell);
        return (
          <Tile
            key={cell}
            move={cell}
            owner={owner}
            winning={!!winning?.includes(cell)}
            last={last === cell}
            className="cell"
            {...pick}
          >
            {owner && (
              <span className="mark">{owner === "red" ? "X" : "O"}</span>
            )}
            {overlay && <span className="magic">{magic}</span>}
          </Tile>
        );
      })}
    </div>
  );
};

let seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export let statusText = (
  s: Status,
  kind: GameKind,
  myTeam: Team | null
): string => {
  switch (s.kind) {
    case "idle":
      return "";
    case "over":
      return s.result === "draw"
        ? "It's a draw!"
        : `${teamName(s.result)} wins!`;
    case "paused":
      return `Paused. ${teamName(s.team)} moves next.`;
    case "gap": {
      let prefix = s.last
        ? kind === "ns"
          ? `${teamName(s.last.team)} took ${s.last.move}. `
          : `${teamName(s.last.team)} moved. `
        : "";
      return `${prefix}${teamName(s.team)}, get ready…`;
    }
    case "open":
      return s.team === myTeam
        ? `Your team's turn! Vote now: ${seconds(s.msLeft)}s`
        : `${teamName(s.team)} is voting: ${seconds(s.msLeft)}s`;
    case "closing":
      return "Counting votes…";
  }
};

export let StatusBar = ({
  s,
  kind,
  myTeam
}: {
  s: Status;
  kind: GameKind;
  myTeam: Team | null;
}) => {
  let team = s.kind === "over" ? resultTeam(s.result) : "team" in s && s.team;
  let progress = s.kind === "open" ? s.msLeft / s.total : 0;
  return (
    <div className={`status ${team || ""} ${s.kind}`} data-testid="status">
      <div className="status-text">{statusText(s, kind, myTeam)}</div>
      <div className="status-bar">
        <div
          className="status-fill"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
};

let resultTeam = (r: Result): Team | null => (r === "draw" ? null : r);

export const TITLES: Record<GameKind, string> = {
  ns: "Pick 15",
  ttt: "Tic-tac-toe"
};

export interface ScreenProps {
  g: GameRow;
  now: number;
  myTeam: Team | null;
  myVote?: number | null;
  tally?: Map<number, number>;
  onPick?: (move: number) => void;
}

export let GameScreen = ({
  g,
  now,
  myTeam,
  myVote,
  tally,
  onPick
}: ScreenProps) => {
  let kind = kindOf(g)!;
  let moves = movesOf(g, kind);
  let s = status(g, now);
  let winning = s.kind === "over" ? s.outcome.winning : null;
  let last = s.kind === "gap" ? (s.last?.move ?? null) : null;
  let pick: PickProps = {
    pickable: s.kind === "open" && s.team === myTeam,
    legal: legalFor(g),
    myVote,
    tally,
    onPick
  };
  return (
    <div className={`screen ${kind}`}>
      <h1>{TITLES[kind]}</h1>
      <StatusBar s={s} kind={kind} myTeam={myTeam} />
      {kind === "ns" ? (
        <NumberStrip moves={moves} winning={winning} last={last} {...pick} />
      ) : (
        <Board cells={moves} winning={winning} last={last} {...pick} />
      )}
    </div>
  );
};

export let RevealScreen = ({ g }: { g: GameRow }) => (
  <div className="screen reveal">
    <h1>{TITLES.ttt}</h1>
    <Board
      cells={g.ttt_moves}
      overlay
      winning={outcome("ttt", g.ttt_moves).winning}
    />
  </div>
);

export let Lobby = ({ myTeam }: { myTeam: Team | null }) => (
  <div className="screen lobby">
    <h1>Welcome!</h1>
    <p className="rules">
      {myTeam ? "Hang tight. The game will start soon." : "Joining a team…"}
    </p>
  </div>
);

export let TeamBanner = ({ team }: { team: Team | null }) => (
  <div className={`team-banner ${team ?? ""}`}>
    {team ? `You're on Team ${teamName(team)}` : "Joining…"}
  </div>
);
