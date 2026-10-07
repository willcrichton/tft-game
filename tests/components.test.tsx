import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test, vi } from "vitest";
import {
  Board,
  GameScreen,
  NumberStrip,
  RevealScreen,
  revealCaption,
  statusText
} from "../src/components";
import { type GameRow, INITIAL } from "../src/state";

let T0 = Date.parse("2026-10-07T12:00:00Z");
let iso = (ms: number) => new Date(ms).toISOString();

let open = (over: Partial<GameRow> = {}): GameRow => ({
  ...INITIAL,
  phase: "ns",
  paused: false,
  round: 3,
  round_starts_at: iso(T0),
  round_ends_at: iso(T0 + 5000),
  ...over
});

let tile = (container: HTMLElement, move: number) =>
  container.querySelector(`[data-move="${move}"]`) as HTMLButtonElement;

describe("NumberStrip", () => {
  test("shows only the digits 1-9 and ownership, never sums", () => {
    let { container } = render(<NumberStrip moves={[2, 6, 7, 8]} />);
    expect(screen.getByTestId("strip").textContent).toBe("123456789");
    expect(tile(container, 2).className).toContain("red");
    expect(tile(container, 6).className).toContain("blue");
    expect(tile(container, 7).className).toContain("red");
    expect(tile(container, 1).className).not.toMatch(/red|blue/);
  });

  test("only legal tiles are clickable when pickable", () => {
    let onPick = vi.fn();
    let { container } = render(
      <NumberStrip moves={[5]} pickable legal={[1, 2]} onPick={onPick} />
    );
    fireEvent.click(tile(container, 5));
    fireEvent.click(tile(container, 9));
    fireEvent.click(tile(container, 1));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(1);
  });
});

describe("Board", () => {
  test("marks red X and blue O", () => {
    render(<Board cells={[4, 0]} />);
    expect(screen.getByTestId("board").textContent).toBe("OX");
  });

  test("overlay shows the magic square in reading order", () => {
    render(<Board cells={[]} overlay />);
    expect(screen.getByTestId("board").textContent).toBe("276951438");
  });
});

describe("GameScreen", () => {
  test("voting team can vote, other team cannot", () => {
    let onPick = vi.fn();
    let g = open();
    let { container, rerender } = render(
      <GameScreen g={g} now={T0 + 100} myTeam="blue" onPick={onPick} />
    );
    fireEvent.click(tile(container, 5));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toContain("Red is voting");
    rerender(<GameScreen g={g} now={T0 + 100} myTeam="red" onPick={onPick} />);
    fireEvent.click(tile(container, 5));
    expect(onPick).toHaveBeenCalledWith(5);
    expect(screen.getByTestId("status").textContent).toContain("Vote now: 5s");
  });

  test("in-progress number game never highlights a winning triple", () => {
    let { container } = render(
      <GameScreen g={open({ ns_moves: [2, 1, 6, 3] })} now={T0} myTeam="red" />
    );
    expect(container.querySelectorAll(".winning").length).toBe(0);
  });

  test("finished game highlights the winning triple", () => {
    let { container } = render(
      <GameScreen
        g={open({ ns_moves: [2, 1, 6, 3, 7], ns_result: "red", paused: true })}
        now={T0}
        myTeam="red"
      />
    );
    let winning = [...container.querySelectorAll(".winning")].map(
      e => (e as HTMLElement).dataset.move
    );
    expect(winning).toEqual(["2", "6", "7"]);
    expect(screen.getByTestId("status").textContent).toContain("Red wins!");
  });

  test("tally badges render counts", () => {
    let { container } = render(
      <GameScreen
        g={open()}
        now={T0}
        myTeam={null}
        tally={
          new Map([
            [5, 3],
            [2, 1]
          ])
        }
      />
    );
    expect(tile(container, 5).querySelector(".tally-count")?.textContent).toBe(
      "3"
    );
    expect(tile(container, 9).querySelector(".tally")).toBeNull();
  });
});

describe("statusText", () => {
  test("gap announces the last pick", () => {
    expect(
      statusText(
        {
          kind: "gap",
          team: "blue",
          msLeft: 500,
          last: { team: "red", move: 7 }
        },
        "ns",
        "blue"
      )
    ).toBe("Red took 7. Blue, get ready…");
  });

  test("draw", () => {
    expect(
      statusText(
        {
          kind: "over",
          result: "draw",
          outcome: { result: "draw", winning: null }
        },
        "ttt",
        null
      )
    ).toBe("It's a draw!");
  });
});

describe("RevealScreen", () => {
  let g: GameRow = {
    ...INITIAL,
    phase: "reveal",
    ns_moves: [2, 1, 6, 3, 7],
    ns_result: "red",
    ttt_moves: [0, 4, 8]
  };

  test("step 0 shows the ttt game without numbers", () => {
    render(<RevealScreen g={g} />);
    expect(screen.getByTestId("board").textContent).toBe("XOX");
  });

  test("step 1 overlays the magic square on the ttt game", () => {
    render(<RevealScreen g={{ ...g, reveal_step: 1 }} />);
    expect(screen.getByTestId("board").textContent).toBe("X2769O5143X8");
  });

  test("replay maps numbers to their magic-square cells", () => {
    let { container } = render(<RevealScreen g={{ ...g, reveal_step: 6 }} />);
    let board = screen.getByTestId("board");
    let cellOf = (n: number) =>
      board.querySelector(
        `[data-move="${[2, 7, 6, 9, 5, 1, 4, 3, 8].indexOf(n)}"]`
      )!;
    expect(cellOf(2).className).toContain("red");
    expect(cellOf(1).className).toContain("blue");
    expect(cellOf(6).className).toContain("red");
    expect(cellOf(3).className).toContain("blue");
    expect(container.querySelectorAll(".winning").length).toBe(0);
  });

  test("final step highlights the winning triple on both representations", () => {
    let { container } = render(<RevealScreen g={{ ...g, reveal_step: 7 }} />);
    expect(container.querySelectorAll(".strip .winning").length).toBe(3);
    let cells = [...container.querySelectorAll(".board .winning")].map(
      e => (e as HTMLElement).dataset.move
    );
    expect(cells).toEqual(["0", "1", "2"]);
    expect(revealCaption({ ...g, reveal_step: 7 })).toContain(
      "same game all along"
    );
  });
});
