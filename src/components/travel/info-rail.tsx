"use client";

/**
 * InfoRail — the "new value" of the travel widget: a compact grid of tiny
 * destination intelligence tiles. Every tile fetches independently and degrades
 * to a muted placeholder (never a crash, never an error spew) when its lib call
 * returns null or throws. All network work is client-side, in effects, guarded
 * for SSR by the "use client" boundary + the hooks-only-run-on-client contract.
 *
 * Inputs come from the active trip:
 *  - destLat / destLng / destCountryCode (preferred), else we geocode destCity.
 * Settings honoured: tempUnit (C/F) for weather, nwCurrency (GBP/USD) as home.
 */

import { useEffect, useState } from "react";
import {
  Clock,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudDrizzle,
  Coins,
  CalendarHeart,
  Plug,
  StampIcon,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { useSettings } from "@/components/settings-provider";
import { geocodePlace, type GeoPlace } from "@/lib/travel/geocode";
import { rate } from "@/lib/travel/fx";
import { nextHoliday, type Holiday } from "@/lib/travel/holidays";
import {
  countryFacts,
  plugInfo,
  type CountryFacts,
  type PlugInfo,
} from "@/lib/travel/country";
import { destLocalTime, hoursAhead, type LocalTime } from "@/lib/travel/localtime";
import { wmoInfo, type WmoIconName } from "@/lib/travel/wmo";
import { visaRequirement, type VisaRequirement } from "@/lib/travel/visa";

// Map the wmo lib's icon name → an actual lucide component.
const WMO_ICONS: Record<WmoIconName, LucideIcon> = {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudDrizzle,
};

const HOME_CC = "GB"; // default home country for visa lookups (settings later)

export interface InfoRailInput {
  destCity?: string;
  destLat?: number;
  destLng?: number;
  destCountryCode?: string;
}

interface Resolved {
  lat?: number;
  lng?: number;
  countryCode?: string;
  timezone?: string;
}

interface WeatherNow {
  iconName: WmoIconName;
  label: string;
  temp: number; // already in the chosen unit
  unit: "C" | "F";
}

/** A single tiny tile — label + icon + value, muted when value is null. */
function Tile({
  Icon,
  label,
  value,
  sub,
}: {
  Icon: LucideIcon;
  label: string;
  value: string | null | undefined;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-rule-soft/50 bg-ink-2/40 px-2.5 py-2 flex items-start gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brass/80" />
      <div className="min-w-0">
        <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
        </p>
        <p className="mt-0.5 text-[12px] leading-tight text-paper truncate">
          {value ?? <span className="text-paper-faint">—</span>}
        </p>
        {sub && value != null && (
          <p className="text-[10px] text-paper-faint truncate">{sub}</p>
        )}
      </div>
    </div>
  );
}

export function InfoRail({ input }: { input: InfoRailInput }) {
  const { get } = useSettings();
  const tempUnit = get<"C" | "F">("tempUnit", "C");
  const homeCurrency = get<"GBP" | "USD">("nwCurrency", "GBP");

  const [resolved, setResolved] = useState<Resolved>({});
  const [localTime, setLocalTime] = useState<LocalTime | null>(null);
  const [ahead, setAhead] = useState<number | null>(null);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [holiday, setHoliday] = useState<Holiday | null>(null);
  const [facts, setFacts] = useState<CountryFacts | null>(null);
  const [plug, setPlug] = useState<PlugInfo | null>(null);
  const [visa, setVisa] = useState<VisaRequirement | null>(null);

  const keyParts = [
    input.destCity,
    input.destLat,
    input.destLng,
    input.destCountryCode,
  ].join("|");

  // ── Resolve coords + country + timezone (geocode only if missing) ──────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let lat = input.destLat;
      let lng = input.destLng;
      let cc = input.destCountryCode;
      let tz: string | undefined;
      // Geocode when we lack coords/cc/tz and have a city to look up.
      if ((lat == null || lng == null || !cc) && input.destCity) {
        try {
          const g: GeoPlace | null = await geocodePlace(input.destCity);
          if (g) {
            lat = lat ?? g.lat;
            lng = lng ?? g.lng;
            cc = cc ?? g.countryCode;
            tz = g.timezone;
          }
        } catch {
          /* degrade */
        }
      } else if (input.destCity) {
        // Coords present but we still want a tz — geocode best-effort.
        try {
          const g = await geocodePlace(input.destCity);
          if (g) tz = g.timezone;
        } catch {
          /* degrade */
        }
      }
      if (!cancelled) setResolved({ lat, lng, countryCode: cc, timezone: tz });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyParts]);

  // ── Local time + hours-ahead (Intl, pure — refresh each minute) ────────────
  useEffect(() => {
    if (!resolved.timezone) {
      setLocalTime(null);
      setAhead(null);
      return;
    }
    const tick = () => {
      try {
        setLocalTime(destLocalTime(resolved.timezone!));
        setAhead(hoursAhead(resolved.timezone!));
      } catch {
        setLocalTime(null);
        setAhead(null);
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [resolved.timezone]);

  // ── Today's weather at dest (Open-Meteo via lat/lng) ───────────────────────
  useEffect(() => {
    let cancelled = false;
    const { lat, lng } = resolved;
    if (lat == null || lng == null) {
      setWeather(null);
      return;
    }
    (async () => {
      try {
        const tempParam = tempUnit === "F" ? "fahrenheit" : "celsius";
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
          `&longitude=${lng}&current=temperature_2m,weather_code` +
          `&temperature_unit=${tempParam}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        const code = j?.current?.weather_code;
        const t = j?.current?.temperature_2m;
        if (
          typeof code === "number" &&
          typeof t === "number" &&
          Number.isFinite(t)
        ) {
          const info = wmoInfo(code);
          if (!cancelled)
            setWeather({
              iconName: info.iconName,
              label: info.label,
              temp: Math.round(t),
              unit: tempUnit,
            });
        } else if (!cancelled) {
          setWeather(null);
        }
      } catch {
        if (!cancelled) setWeather(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved.lat, resolved.lng, tempUnit]);

  // ── Currency rate home→dest (dest currency from country facts) ─────────────
  useEffect(() => {
    let cancelled = false;
    const cc = resolved.countryCode;
    if (!cc) {
      setFxRate(null);
      setFacts(null);
      return;
    }
    (async () => {
      try {
        const cf = await countryFacts(cc);
        if (!cancelled) setFacts(cf);
        const destCur = cf?.currencyCode;
        if (destCur && destCur !== homeCurrency) {
          const r = await rate(homeCurrency, destCur);
          if (!cancelled) setFxRate(r);
        } else if (!cancelled) {
          setFxRate(null); // same currency → nothing to show
        }
      } catch {
        if (!cancelled) {
          setFxRate(null);
          setFacts(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved.countryCode, homeCurrency]);

  // ── Next public holiday, plug info, visa (country-code driven) ─────────────
  useEffect(() => {
    let cancelled = false;
    const cc = resolved.countryCode;
    if (!cc) {
      setHoliday(null);
      setPlug(null);
      setVisa(null);
      return;
    }
    (async () => {
      try {
        const h = await nextHoliday(cc);
        if (!cancelled) setHoliday(h);
      } catch {
        if (!cancelled) setHoliday(null);
      }
      try {
        const p = await plugInfo(cc);
        if (!cancelled) setPlug(p);
      } catch {
        if (!cancelled) setPlug(null);
      }
      try {
        const v = await visaRequirement(HOME_CC, cc);
        if (!cancelled) setVisa(v);
      } catch {
        if (!cancelled) setVisa(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved.countryCode]);

  // ── Derived display strings ────────────────────────────────────────────────
  const WeatherIcon = weather ? WMO_ICONS[weather.iconName] ?? Sun : Sun;
  const timeValue = localTime
    ? `${localTime.time}${ahead != null && ahead !== 0 ? ` (${ahead > 0 ? "+" : ""}${ahead}h)` : ""}`
    : null;
  const fxDestCur = facts?.currencyCode;
  const fxValue =
    fxRate != null && fxDestCur
      ? `1 ${homeCurrency} = ${fxRate.toFixed(2)} ${fxDestCur}`
      : null;
  const holidayValue = holiday
    ? `${holiday.localName}`
    : null;
  const plugValue = plug?.plugTypes?.length
    ? `Type ${plug.plugTypes.join("/")}`
    : null;
  const factsValue = facts ? facts.capital || facts.name : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      <Tile Icon={Clock} label="Local time" value={timeValue} sub={localTime?.date} />
      <Tile
        Icon={WeatherIcon}
        label="Weather"
        value={
          weather ? `${weather.temp}°${weather.unit} ${weather.label}` : null
        }
      />
      <Tile Icon={Coins} label="Currency" value={fxValue} />
      <Tile
        Icon={CalendarHeart}
        label="Next holiday"
        value={holidayValue}
        sub={holiday?.date}
      />
      <Tile
        Icon={Plug}
        label="Plug"
        value={plugValue}
        sub={plug ? `${plug.voltage} ${plug.frequency}` : undefined}
      />
      <Tile
        Icon={StampIcon}
        label="Visa (from GB)"
        value={visa ? visa.label : null}
      />
      <Tile
        Icon={Landmark}
        label="Country"
        value={factsValue}
        sub={
          facts
            ? `${facts.flagEmoji} ${facts.languages?.[0] ?? facts.region ?? ""}`.trim()
            : undefined
        }
      />
    </div>
  );
}

export default InfoRail;
