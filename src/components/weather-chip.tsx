"use client";

/**
 * WeatherChip — geolocated current conditions for the Command Center greeting row.
 *
 * Data flow (all CLIENT-SIDE; no API key, no server round-trip):
 *  1. Resolve {lat,lon}: cached in localStorage("hub-geo") → else
 *     navigator.geolocation.getCurrentPosition. Denial is handled gracefully
 *     (no crash) and surfaces a subtle "Enable location" affordance.
 *  2. Fetch Open-Meteo current weather (temperature_2m, weather_code,
 *     wind_speed_10m). temperature_unit follows the `tempUnit` setting; the
 *     reading re-fetches when the unit flips.
 *  3. WMO weather_code → condition label + lucide icon.
 *  4. Optional free no-key reverse geocode (bigdatacloud) for a city label;
 *     falls back to "Local" on failure.
 *  5. Last good reading is cached in localStorage("hub-weather") so a cold mount
 *     paints instantly while the live fetch resolves.
 *
 * SSR-safe: this is a "use client" component and every navigator/window/
 * localStorage touch is guarded so Next's server build never references them.
 */

import { useEffect, useRef, useState } from "react";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudDrizzle,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { useSettings } from "@/components/settings-provider";

// ── Storage keys ──────────────────────────────────────────────────────────────
const GEO_KEY = "hub-geo";
const WEATHER_KEY = "hub-weather";

type Geo = { lat: number; lon: number };

type Reading = {
  tempC: number; // store canonical Celsius so we can convert when unit flips
  code: number;
  wind: number; // km/h
  city: string;
  fetchedAt: number;
};

type Status = "loading" | "ok" | "denied" | "error";

// ── WMO weather_code → label + icon ─────────────────────────────────────────────
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
function wmo(code: number): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: "Clear", Icon: Sun };
  if (code === 1) return { label: "Mostly clear", Icon: Sun };
  if (code === 2) return { label: "Partly cloudy", Icon: Cloud };
  if (code === 3) return { label: "Overcast", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "Fog", Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: "Drizzle", Icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { label: "Rain", Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: "Snow", Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: "Showers", Icon: CloudRain };
  if (code === 85 || code === 86) return { label: "Snow showers", Icon: CloudSnow };
  if (code >= 95 && code <= 99) return { label: "Thunderstorm", Icon: CloudLightning };
  return { label: "—", Icon: Cloud };
}

// ── localStorage helpers (SSR-guarded) ──────────────────────────────────────────
function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// Open-Meteo returns the temperature already in the requested unit. We persist
// canonical Celsius so a unit flip never needs a network round-trip to redisplay.
function toCelsius(value: number, unit: "C" | "F"): number {
  return unit === "F" ? (value - 32) * (5 / 9) : value;
}
function fromCelsius(c: number, unit: "C" | "F"): number {
  return unit === "F" ? c * (9 / 5) + 32 : c;
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    if (!res.ok) return "Local";
    const j = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
    };
    return j.city || j.locality || j.principalSubdivision || "Local";
  } catch {
    return "Local";
  }
}

function resolveGeo(): Promise<Geo> {
  // Cached first.
  const cached = readJSON<Geo>(GEO_KEY);
  if (
    cached &&
    typeof cached.lat === "number" &&
    typeof cached.lon === "number"
  ) {
    return Promise.resolve(cached);
  }
  return new Promise<Geo>((resolve, reject) => {
    if (
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      reject(new Error("no-geo"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const geo: Geo = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        };
        writeJSON(GEO_KEY, geo);
        resolve(geo);
      },
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  });
}

export function WeatherChip() {
  const { get } = useSettings();
  const tempUnit = get("tempUnit", "C") as "C" | "F";

  // Seed from the last good reading for an instant paint (no flicker).
  const [reading, setReading] = useState<Reading | null>(() =>
    readJSON<Reading>(WEATHER_KEY),
  );
  const [status, setStatus] = useState<Status>(() =>
    readJSON<Reading>(WEATHER_KEY) ? "ok" : "loading",
  );
  // Cache the resolved geo across re-fetches (e.g. unit flips) so we don't
  // re-prompt the browser permission each time the unit changes.
  const geoRef = useRef<Geo | null>(null);

  async function load(unit: "C" | "F") {
    try {
      const geo = geoRef.current ?? (await resolveGeo());
      geoRef.current = geo;
      const unitParam = unit === "F" ? "fahrenheit" : "celsius";
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=${unitParam}`,
      );
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const j = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          weather_code?: number;
          wind_speed_10m?: number;
        };
      };
      const cur = j.current;
      if (!cur || typeof cur.temperature_2m !== "number") {
        throw new Error("bad-payload");
      }
      const city = await reverseGeocode(geo.lat, geo.lon);
      const next: Reading = {
        tempC: toCelsius(cur.temperature_2m, unit),
        code: cur.weather_code ?? 0,
        wind: cur.wind_speed_10m ?? 0,
        city,
        fetchedAt: Date.now(),
      };
      setReading(next);
      setStatus("ok");
      writeJSON(WEATHER_KEY, next);
    } catch (err) {
      // Geolocation denial/unavailable → distinct affordance; anything else → error.
      const code =
        typeof err === "object" && err && "code" in err
          ? (err as GeolocationPositionError).code
          : undefined;
      const denied =
        code === 1 /* PERMISSION_DENIED */ ||
        (err instanceof Error && err.message === "no-geo");
      // Keep any previously cached reading on screen; only flip status.
      setStatus(denied ? "denied" : reading ? "ok" : "error");
    }
  }

  // Initial load + re-fetch whenever the unit flips.
  useEffect(() => {
    void load(tempUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempUnit]);

  function requestLocation() {
    // User-gesture retry: clear the "no-geo" memory and re-prompt.
    geoRef.current = null;
    setStatus("loading");
    void load(tempUnit);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const shell =
    "flex items-center gap-2 rounded-lg border border-rule-soft/50 bg-paper/[0.025] px-2.5 py-1.5 shrink-0";

  if (status === "denied" && !reading) {
    return (
      <button
        type="button"
        onClick={requestLocation}
        className={`${shell} hover:bg-paper/[0.05] transition-colors`}
        title="Enable location for local weather"
      >
        <MapPin className="w-3.5 h-3.5 text-paper-faint" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint">
          Enable location
        </span>
      </button>
    );
  }

  if ((status === "loading" || status === "error") && !reading) {
    return (
      <div className={shell} aria-busy={status === "loading"}>
        <span className="w-3.5 h-3.5 rounded-full bg-paper/[0.08] animate-pulse" />
        <span className="inline-block w-14 h-3 rounded bg-paper/[0.06] animate-pulse" />
      </div>
    );
  }

  if (!reading) return null;

  const { Icon, label } = wmo(reading.code);
  const displayTemp = Math.round(fromCelsius(reading.tempC, tempUnit));

  return (
    <div className={shell} title={`${label} · ${Math.round(reading.wind)} km/h wind`}>
      <Icon className="w-4 h-4 text-brass/80 shrink-0" />
      <span className="font-display text-[15px] text-paper leading-none tabular-nums">
        {displayTemp}°{tempUnit}
      </span>
      <span className="w-px h-3 bg-rule-soft/50 shrink-0" />
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint truncate max-w-[90px]">
        {reading.city}
      </span>
    </div>
  );
}
