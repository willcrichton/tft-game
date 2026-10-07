import { describe, expect, test } from "vitest";
import {
  cellOfNumber,
  fifteenTriple,
  LINES,
  legalMoves,
  MAGIC,
  outcome,
  pickMove,
  tally,
  tttLine,
  turnTeam
} from "../src/logic";

let allTriples = (): number[][] => {
  let out: number[][] = [];
  for (let a = 1; a <= 9; a++)
    for (let b = a + 1; b <= 9; b++)
      for (let c = b + 1; c <= 9; c++) out.push([a, b, c]);
  return out;
};

describe("isomorphism", () => {
  test("magic square rows, columns and diagonals all sum to 15", () => {
    for (let line of LINES) {
      expect(line.reduce((s, c) => s + MAGIC[c], 0)).toBe(15);
    }
  });

  test("a triple sums to 15 iff its cells form a line", () => {
    for (let t of allTriples()) {
      let sums = fifteenTriple(t) !== null;
      let isLine = tttLine(t.map(cellOfNumber)) !== null;
      expect(isLine).toBe(sums);
    }
  });

  test("exactly 8 winning triples", () => {
    expect(allTriples().filter(t => fifteenTriple(t)).length).toBe(8);
  });
});

describe("outcome", () => {
  test("ns win for red", () => {
    expect(outcome("ns", [2, 1, 6, 3, 7])).toEqual({
      result: "red",
      winning: [2, 6, 7]
    });
  });

  test("ns no win with four numbers that do not form a 15-triple", () => {
    expect(outcome("ns", [1, 5, 2, 6, 3, 7, 4]).result).toBeNull();
  });

  test("ns blue win", () => {
    expect(outcome("ns", [1, 4, 2, 5, 8, 6]).result).toBe("blue");
  });

  test("ttt red diagonal", () => {
    expect(outcome("ttt", [0, 1, 4, 2, 8])).toEqual({
      result: "red",
      winning: [0, 4, 8]
    });
  });

  test("draw on full board", () => {
    expect(outcome("ttt", [0, 4, 8, 1, 7, 6, 2, 5, 3]).result).toBe("draw");
  });

  test("in progress", () => {
    expect(outcome("ttt", [0, 4]).result).toBeNull();
  });
});

describe("turns and legality", () => {
  test("red moves first", () => {
    expect(turnTeam([])).toBe("red");
    expect(turnTeam([5])).toBe("blue");
  });

  test("legal moves exclude taken", () => {
    expect(legalMoves("ns", [5, 1])).toEqual([2, 3, 4, 6, 7, 8, 9]);
    expect(legalMoves("ttt", [0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("voting", () => {
  test("tally ignores illegal votes", () => {
    expect(tally([1, 1, 2, 9], [1, 2])).toEqual(
      new Map([
        [1, 2],
        [2, 1]
      ])
    );
  });

  test("plurality wins", () => {
    expect(pickMove([3, 3, 4], [3, 4, 5], () => 0.99)).toBe(3);
  });

  test("ties broken by rng among tied options", () => {
    expect(pickMove([3, 4], [3, 4, 5], () => 0)).toBe(3);
    expect(pickMove([3, 4], [3, 4, 5], () => 0.99)).toBe(4);
  });

  test("no votes picks a random legal move", () => {
    expect(pickMove([], [2, 7], () => 0.6)).toBe(7);
    expect(pickMove([9], [2, 7], () => 0)).toBe(2);
  });
});
