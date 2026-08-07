// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatTile } from "./stat-tile";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function interactiveTile(callbacks?: {
  drill?: () => void;
  edit?: () => void;
  hide?: () => void;
}) {
  return (
    <StatTile
      label="Net Worth"
      value="£134,605"
      onClick={callbacks?.drill ?? (() => undefined)}
      onHide={callbacks?.hide ?? (() => undefined)}
      sub={
        <button type="button" aria-label="Edit value" onClick={callbacks?.edit}>
          Edit
        </button>
      }
    />
  );
}

describe("StatTile", () => {
  it("keeps its drill, hide, and inline controls as sibling buttons in server HTML", () => {
    const template = document.createElement("template");
    template.innerHTML = renderToString(interactiveTile());

    expect(template.content.querySelector("button button")).toBeNull();
    expect(
      Array.from(template.content.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Net Worth", "Hide Net Worth", "Edit value"]);
  });

  it("hydrates the server markup without React's invalid-nesting warning", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = renderToString(interactiveTile());
    document.body.append(container);

    await act(async () => {
      root = hydrateRoot(container, interactiveTile());
      await Promise.resolve();
    });

    const errors = consoleError.mock.calls.flat().join(" ");
    expect(errors).not.toContain("cannot be a descendant");
    expect(errors).not.toContain("cannot contain a nested");
  });

  it("routes tile, edit, and hide clicks to their independent actions", () => {
    let drillCount = 0;
    let editCount = 0;
    let hideCount = 0;
    const container = document.createElement("div");
    document.body.append(container);

    act(() => {
      root = createRoot(container);
      root.render(
        interactiveTile({
          drill: () => drillCount++,
          edit: () => editCount++,
          hide: () => hideCount++,
        }),
      );
    });

    const button = (label: string) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

    act(() => button("Net Worth").click());
    act(() => button("Edit value").click());
    act(() => button("Hide Net Worth").click());

    expect({ drillCount, editCount, hideCount }).toEqual({
      drillCount: 1,
      editCount: 1,
      hideCount: 1,
    });
  });
});
