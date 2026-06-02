/**
 * Shared WMO weather-code → { label, iconName } map.
 *
 * Extracted from <WeatherChip> so the travel widget and the weather chip share a
 * single source of truth. This module is icon-library agnostic: it returns a
 * stable `iconName` (a lucide-react export name) rather than a component, so it
 * stays a pure, SSR-safe, dependency-free data helper that can be imported from
 * anywhere (server or client). Consumers map `iconName` → an actual icon.
 *
 * WMO code reference: https://open-meteo.com/en/docs (weather_code).
 */

/** lucide-react export names used by the WMO map. */
export type WmoIconName =
  | "Sun"
  | "Cloud"
  | "CloudRain"
  | "CloudSnow"
  | "CloudLightning"
  | "CloudFog"
  | "CloudDrizzle";

export interface WmoInfo {
  label: string;
  iconName: WmoIconName;
}

/**
 * Map an Open-Meteo `weather_code` to a human label + lucide icon name.
 * Unknown codes fall back to a neutral "—" / Cloud.
 */
export function wmoInfo(code: number): WmoInfo {
  if (code === 0) return { label: "Clear", iconName: "Sun" };
  if (code === 1) return { label: "Mostly clear", iconName: "Sun" };
  if (code === 2) return { label: "Partly cloudy", iconName: "Cloud" };
  if (code === 3) return { label: "Overcast", iconName: "Cloud" };
  if (code === 45 || code === 48) return { label: "Fog", iconName: "CloudFog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", iconName: "CloudDrizzle" };
  if (code >= 61 && code <= 67) return { label: "Rain", iconName: "CloudRain" };
  if (code >= 71 && code <= 77) return { label: "Snow", iconName: "CloudSnow" };
  if (code >= 80 && code <= 82) return { label: "Showers", iconName: "CloudRain" };
  if (code === 85 || code === 86) return { label: "Snow showers", iconName: "CloudSnow" };
  if (code >= 95 && code <= 99) return { label: "Thunderstorm", iconName: "CloudLightning" };
  return { label: "—", iconName: "Cloud" };
}
