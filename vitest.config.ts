import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Phase 7 test config.
 *
 * Two kinds of tests live here:
 *  - Convex function tests (convex/*.test.ts) run under @edge-runtime/vm, the
 *    environment convex-test expects (matches the real Convex runtime closely).
 *  - Pure-logic / component-logic tests (src/**\/*.test.ts(x)) run under jsdom,
 *    because src/lib/staleness uses Intl + Date and the calendar widget module
 *    transitively imports React + lucide-react.
 *
 * We use per-file `environmentMatchGlobs` so a single `vitest run` covers both.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    // Default to edge-runtime (Convex); override per-glob for component tests.
    environment: "edge-runtime",
    environmentMatchGlobs: [
      ["convex/**", "edge-runtime"],
      ["src/**", "jsdom"],
    ],
    include: ["convex/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // convex-test + convex must be processed by vite, not externalized.
        inline: ["convex-test", "convex"],
      },
    },
  },
});
