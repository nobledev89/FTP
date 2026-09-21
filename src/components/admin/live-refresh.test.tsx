// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveRefresh } from "./live-refresh";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LiveRefresh", () => {
  it("refreshes the route on the configured interval", () => {
    render(<LiveRefresh intervalMs={5_000} serverUpdatedAt="2026-09-21T08:00:00Z" />);

    act(() => vi.advanceTimersByTime(5_000));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("can pause automatic updates and still refresh manually", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<LiveRefresh intervalMs={5_000} serverUpdatedAt="2026-09-21T08:00:00Z" />);

    await user.click(screen.getByRole("button", { name: "Pause live updates" }));
    expect(screen.getByText("Updates paused")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
