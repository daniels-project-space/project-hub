"use client";

/**
 * FlightChip — small flight-number lookup. Calls api.travelActions.flightStatus,
 * which returns { available:false, reason } until the AeroDataBox key is added
 * (today: always unavailable). We render the disabled/“add key” state from that
 * reason rather than treating it as an error.
 */

import { useState } from "react";
import { Plane, Loader2 } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";

type FlightEndpoint = {
  airport?: string;
  scheduled?: string;
  actual?: string;
  terminal?: string;
};
type FlightResult =
  | { available: false; reason: string }
  | {
      available: true;
      flightNo: string;
      status: string;
      departure: FlightEndpoint;
      arrival: FlightEndpoint;
    };

export function FlightChip() {
  const flightStatus = useAction(api.travelActions.flightStatus);
  const [flightNo, setFlightNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FlightResult | null>(null);

  const lookup = async () => {
    const fn = flightNo.trim();
    if (!fn || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const r = (await flightStatus({ flightNo: fn })) as FlightResult;
      setResult(r);
    } catch (e) {
      setResult({
        available: false,
        reason: e instanceof Error ? e.message : "Lookup failed",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5">
          <Plane className="h-3.5 w-3.5 shrink-0 text-brass/80" />
          <input
            type="text"
            value={flightNo}
            onChange={(e) => setFlightNo(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="Flight no (e.g. BA432)"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-paper placeholder:text-paper-faint"
          />
        </div>
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !flightNo.trim()}
          className="shrink-0 rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-paper-faint hover:text-paper hover:border-brass/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Check"}
        </button>
      </div>

      {result && !result.available && (
        <p className="text-[11px] text-paper-faint">
          {/^AeroDataBox API key not configured$/.test(result.reason)
            ? "Flight status disabled — add AeroDataBox key to enable."
            : result.reason}
        </p>
      )}

      {result && result.available && (
        <div className="rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-2 text-[11px] text-paper space-y-0.5">
          <p className="font-mono text-brass/85">
            {result.flightNo} · {result.status}
          </p>
          <p className="text-paper-faint">
            {result.departure.airport ?? "—"}
            {result.departure.scheduled ? ` ${result.departure.scheduled}` : ""} →{" "}
            {result.arrival.airport ?? "—"}
            {result.arrival.scheduled ? ` ${result.arrival.scheduled}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default FlightChip;
