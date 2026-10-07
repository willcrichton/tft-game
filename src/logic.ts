export type Team = "red" | "blue";
export type Phase = "lobby" | "ns" | "ttt" | "reveal";
export type GameKind = "ns" | "ttt";
export type Result = Team | "draw";

export const TEAMS: Team[] = ["red", "blue"];

export const MAGIC = [2, 7, 6, 9, 5, 1, 4, 3, 8];

export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

export let teamOfMove = (index: number): Team =>
  index % 2 === 0 ? "red" : "blue";

export let turnTeam = (moves: number[]): Team => teamOfMove(moves.length);

export let options = (kind: GameKind): number[] =>
  kind === "ns" ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

export let legalMoves = (kind: GameKind, moves: number[]): number[] =>
  options(kind).filter(m => !moves.includes(m));

export let movesOf = (moves: number[], team: Team): number[] =>
  moves.filter((_, i) => teamOfMove(i) === team);

export let cellOfNumber = (n: number): number => MAGIC.indexOf(n);

let triples = <T>(xs: T[]): T[][] =>
  xs.flatMap((a, i) =>
    xs.slice(i + 1).flatMap((b, j) => xs.slice(i + j + 2).map(c => [a, b, c]))
  );

export let fifteenTriple = (nums: number[]): number[] | null =>
  triples(nums).find(t => t[0] + t[1] + t[2] === 15) ?? null;

export let tttLine = (cells: number[]): number[] | null =>
  LINES.find(line => line.every(c => cells.includes(c))) ?? null;

export interface Outcome {
  result: Result | null;
  winning: number[] | null;
}

export let outcome = (kind: GameKind, moves: number[]): Outcome => {
  for (let team of TEAMS) {
    let mine = movesOf(moves, team);
    let winning = kind === "ns" ? fifteenTriple(mine) : tttLine(mine);
    if (winning) return { result: team, winning };
  }
  let full = moves.length === 9;
  return { result: full ? "draw" : null, winning: null };
};

export let tally = (votes: number[], legal: number[]): Map<number, number> => {
  let counts = new Map<number, number>();
  for (let v of votes) {
    if (legal.includes(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
};

export let pickMove = (
  votes: number[],
  legal: number[],
  rng: () => number = Math.random
): number => {
  let counts = tally(votes, legal);
  let best = Math.max(0, ...counts.values());
  let pool = best === 0 ? legal : legal.filter(m => counts.get(m) === best);
  return pool[Math.floor(rng() * pool.length)];
};
