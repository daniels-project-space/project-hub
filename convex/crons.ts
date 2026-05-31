import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily net-worth snapshot (Wave 1 · Wealth). Refreshes live prices best-effort
// then records one `netWorthSnapshots` row. Runs 06:00 UTC.
crons.daily(
  "net-worth-snapshot",
  { hourUTC: 6, minuteUTC: 0 },
  internal.wealthActions.snapshot,
);

export default crons;
