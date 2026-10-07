import { act, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let api = vi.hoisted(() => ({
  joinGame: vi.fn(() => Promise.resolve("red")),
  leaveGame: vi.fn(() => Promise.resolve(new Response())),
  fetchGame: vi.fn(),
  serverNow: vi.fn(),
  subscribeGame: vi.fn()
}));
vi.mock("../src/api", () => api);

import { usePlayer } from "../src/hooks";

let seen: { id: string; team: string | null }[] = [];
let Probe = ({ epoch }: { epoch: number | undefined }) => {
  seen.push(usePlayer(epoch));
  return null;
};

describe("usePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    seen = [];
    api.joinGame.mockClear();
    api.leaveGame.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  test("joins once the game row is known, then heartbeats", async () => {
    let { rerender } = render(<Probe epoch={undefined} />);
    expect(api.joinGame).not.toHaveBeenCalled();
    rerender(<Probe epoch={0} />);
    await act(async () => {});
    expect(api.joinGame).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1].team).toBe("red");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api.joinGame).toHaveBeenCalledTimes(4);
  });

  test("keeps the same id across remounts so refreshes keep the team", () => {
    let first = render(<Probe epoch={0} />);
    let id = seen[0].id;
    first.unmount();
    render(<Probe epoch={0} />);
    expect(seen[seen.length - 1].id).toBe(id);
    expect(api.joinGame.mock.calls.every(c => c[0] === id)).toBe(true);
  });

  test("leaves on pagehide and rejoins when visible again", () => {
    render(<Probe epoch={0} />);
    let id = seen[0].id;
    window.dispatchEvent(new Event("pagehide"));
    expect(api.leaveGame).toHaveBeenCalledWith(id);
    api.joinGame.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(api.joinGame).toHaveBeenCalledWith(id);
  });

  test("rejoins when the team epoch changes", () => {
    let { rerender } = render(<Probe epoch={0} />);
    rerender(<Probe epoch={1} />);
    expect(api.joinGame).toHaveBeenCalledTimes(2);
  });
});
