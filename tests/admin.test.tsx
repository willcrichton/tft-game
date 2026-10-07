import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test, vi } from "vitest";
import { Controls } from "../src/admin";
import type { Admin } from "../src/api";
import { INITIAL } from "../src/state";

let fakeApi = () =>
  ({
    settings: vi.fn(() => Promise.resolve()),
    setPhase: vi.fn(() => Promise.resolve())
  }) as unknown as Admin & { settings: ReturnType<typeof vi.fn> };

describe("Controls timing", () => {
  test("saving one field does not discard an edit to the other", () => {
    let api = fakeApi();
    let g = { ...INITIAL, window_secs: 5, gap_secs: 2 };
    let counts = { red: 0, blue: 0 };
    let { rerender } = render(
      <Controls api={api} g={g} counts={counts} onLogout={() => {}} />
    );
    let vote = screen.getByLabelText("Vote");
    let gap = screen.getByLabelText("Pause between turns");
    fireEvent.change(vote, { target: { value: "2" } });
    fireEvent.blur(vote);
    expect(api.settings).toHaveBeenLastCalledWith(2, null);
    fireEvent.change(gap, { target: { value: "0.5" } });
    rerender(
      <Controls
        api={api}
        g={{ ...g, window_secs: 2 }}
        counts={counts}
        onLogout={() => {}}
      />
    );
    expect((gap as HTMLInputElement).value).toBe("0.5");
    fireEvent.blur(gap);
    expect(api.settings).toHaveBeenLastCalledWith(null, 0.5);
  });

  test("blurring an unchanged field does not save", () => {
    let api = fakeApi();
    render(
      <Controls
        api={api}
        g={INITIAL}
        counts={{ red: 0, blue: 0 }}
        onLogout={() => {}}
      />
    );
    fireEvent.blur(screen.getByLabelText("Vote"));
    expect(api.settings).not.toHaveBeenCalled();
  });

  test("server changes flow into the inputs", () => {
    let api = fakeApi();
    let counts = { red: 0, blue: 0 };
    let { rerender } = render(
      <Controls api={api} g={INITIAL} counts={counts} onLogout={() => {}} />
    );
    rerender(
      <Controls
        api={api}
        g={{ ...INITIAL, gap_secs: 3 }}
        counts={counts}
        onLogout={() => {}}
      />
    );
    expect(
      (screen.getByLabelText("Pause between turns") as HTMLInputElement).value
    ).toBe("3");
  });
});
