// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const convexState = vi.hoisted(() => ({
  remote: undefined as Record<string, unknown> | undefined,
  setRemote: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => convexState.remote,
  useMutation: () => convexState.setRemote,
}));

import { SettingsProvider, useSettings } from "./settings-provider";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

function SettingsProbe() {
  const { get } = useSettings();
  return (
    <output>
      {get("nwCurrency", "GBP")}|{get<string[]>("hiddenApps", []).join(",")}
    </output>
  );
}

function tree() {
  return (
    <SettingsProvider>
      <SettingsProbe />
    </SettingsProvider>
  );
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  convexState.remote = undefined;
  convexState.setRemote.mockReset();
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SettingsProvider hydration", () => {
  it("uses defaults for SSR and the first client render, then applies browser settings", async () => {
    window.localStorage.clear();
    convexState.remote = undefined;
    const serverHtml = renderToString(tree());
    const serverTemplate = document.createElement("template");
    serverTemplate.innerHTML = serverHtml;
    expect(serverTemplate.content.textContent).toBe("GBP|");

    // Simulate data becoming available between the server render and hydration.
    convexState.remote = { hiddenApps: ["project-hub"] };
    window.localStorage.setItem(
      "hub-settings",
      JSON.stringify({ nwCurrency: "USD", hiddenApps: ["remote-work-hub"] }),
    );

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);

    await act(async () => {
      root = hydrateRoot(container, tree());
      await Promise.resolve();
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      "Hydration failed",
    );
    // Local optimistic state wins after hydration, matching provider semantics.
    expect(container.querySelector("output")?.textContent).toBe(
      "USD|remote-work-hub",
    );
  });
});
