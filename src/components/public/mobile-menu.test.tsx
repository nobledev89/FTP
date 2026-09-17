// @vitest-environment jsdom
import { cleanup, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { menuInertTargetProps } from "./menu-inert";
import { MobileMenu } from "./mobile-menu";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type Listener = (event: MediaQueryListEvent) => void;
let viewportListeners: Listener[] = [];

beforeEach(() => {
  pathname = "/";
  viewportListeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: string, listener: Listener) => viewportListeners.push(listener),
    removeEventListener: (_: string, listener: Listener) => {
      viewportListeners = viewportListeners.filter((item) => item !== listener);
    },
  }));
});

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
});

const navigation = [
  { label: "Latest", href: "/blog" },
  { label: "Payments", href: "/topics/payments" },
];

function renderMenu() {
  const result = render(
    <>
      <main data-testid="content" {...menuInertTargetProps}>
        <a href="/behind">Behind the menu</a>
      </main>
      <MobileMenu navigation={navigation} />
    </>,
  );
  return { ...result, toggle: screen.getByRole("button", { name: "Open menu" }) };
}

describe("MobileMenu", () => {
  it("starts closed, inert, and hidden from assistive technology", () => {
    const { toggle } = renderMenu();
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hasAttribute("inert")).toBe(true);
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("content").inert).toBeFalsy();
  });

  it("opens with focus on the first link, locks scroll, and makes page content inert", async () => {
    const user = userEvent.setup();
    const { toggle } = renderMenu();

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Close menu");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(panel?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(screen.getAllByRole("link", { name: /Latest/ })[0]);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByTestId("content").inert).toBe(true);
  });

  it("closes on Escape, restores focus to the toggle, and releases the page", async () => {
    const user = userEvent.setup();
    const { toggle } = renderMenu();

    await user.click(toggle);
    await user.keyboard("{Escape}");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.getByTestId("content").inert).toBe(false);
  });

  it("closes when the viewport reaches the desktop breakpoint", async () => {
    const user = userEvent.setup();
    const { toggle } = renderMenu();

    await user.click(toggle);
    act(() => {
      for (const listener of viewportListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes after navigation changes the pathname", async () => {
    const user = userEvent.setup();
    const { toggle, rerender } = renderMenu();

    await user.click(toggle);
    pathname = "/blog";
    rerender(
      <>
        <main data-testid="content" {...menuInertTargetProps} />
        <MobileMenu navigation={navigation} />
      </>,
    );

    expect(screen.getByRole("button", { name: "Open menu" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("marks the current section", () => {
    pathname = "/blog/some-article";
    renderMenu();
    const current = document.querySelector('[aria-current="page"]');
    expect(current?.getAttribute("href")).toBe("/blog");
  });
});
