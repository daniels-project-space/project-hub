import { describe, expect, it } from "vitest";
import { resolveJarvisWidgetTarget } from "./jarvis-host";

describe("resolveJarvisWidgetTarget", () => {
  it("accepts canonical widget keys", () => {
    expect(resolveJarvisWidgetTarget("channelIdea")).toBe("channelIdea");
    expect(resolveJarvisWidgetTarget("remoteWorkHub")).toBe("remoteWorkHub");
  });

  it("accepts the labels Daniel naturally uses", () => {
    expect(resolveJarvisWidgetTarget("show my net worth widget")).toBe("wealth");
    expect(resolveJarvisWidgetTarget("pull up the trip planner")).toBe("travel");
  });

  it("does not invent an unknown widget", () => {
    expect(resolveJarvisWidgetTarget("quantum toaster")).toBeNull();
  });
});
