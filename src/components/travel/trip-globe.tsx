"use client";

/**
 * TripGlobe — interactive 3D globe for the expanded trip view.
 *
 * Engine: MapLibre GL's true globe projection (v5+) over the same CARTO dark
 * raster basemap the 2D widget map uses. We switched away from react-globe.gl
 * (three.js) because that wraps a SINGLE static earth texture onto a sphere —
 * zooming just magnifies a blurry image and it can never resolve to
 * streets/labels, and its markers are WebGL spheres sized in globe-radius units
 * (always chunky). MapLibre uses real tiled imagery, so detail resolves at every
 * zoom level, markers are crisp pixel-sized DOM dots, and country borders +
 * place labels come for free from the basemap.
 *
 * SSR SAFETY (critical):
 *  - "use client" so this file is never evaluated during server rendering, AND
 *    the consumer loads it via next/dynamic(..., { ssr:false }).
 *  - maplibre-gl dereferences `window` at import time, so it is imported ONLY
 *    inside effects via a DYNAMIC import — never at module top. The CSS import is
 *    static (stylesheet imports are SSR-safe).
 *  - Any init/tile failure falls back to a marker list instead of crashing.
 *
 * Behavior:
 *  - Markers colored by `kind`, with a rich hover popup (place image + title).
 *  - Route + flight arcs drawn as densified great-circle lines on the globe.
 *  - On a new trip's points → fitBounds frames the whole itinerary (jumps to that
 *    part of the globe and zooms so every stop fits).
 *  - `focus` change → animated flyTo via map.flyTo(...).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// ── Public types (unchanged — page.tsx imports these) ────────────────────────
export type GlobePointKind =
  | "place"
  | "food"
  | "stay"
  | "flight"
  | "transport"
  | "activity"
  | "leg"
  | "default";

export interface GlobePoint {
  lat: number;
  lng: number;
  label: string;
  kind: GlobePointKind;
  id: string;
  /** Optional photo of the place — shown in the hover popup. */
  imageUrl?: string;
}

export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  /** Optional kind to tint the arc (e.g. "flight" vs the default route). */
  kind?: "route" | "flight";
  /** Optional precomputed [lng,lat] path (real road/rail route from Directions).
   *  When present it's drawn verbatim instead of a great-circle approximation. */
  path?: Array<[number, number]>;
}

export interface TripGlobeProps {
  points: GlobePoint[];
  arcs: GlobeArc[];
  /** Selected stop → animate camera to it. */
  focus?: { lat: number; lng: number } | null;
  /** Called when a globe point is clicked (bubbles the point id up). */
  onPointClick?: (id: string) => void;
  className?: string;
}

// Marker dot color by kind.
const KIND_COLORS: Record<GlobePointKind, string> = {
  place: "#0ea5e9", // sky
  food: "#f97316", // orange
  stay: "#7c3aed", // violet
  flight: "#38bdf8", // light sky
  transport: "#64748b", // slate
  activity: "#10b981", // emerald
  leg: "#d4a574", // brass (hub accent) — multi-destination legs
  default: "#d4a574",
};

const ROUTE_COLOR = "#d4a574"; // brass
const FLIGHT_COLOR = "#38bdf8"; // sky

// CARTO "dark_all" raster basemap (OpenStreetMap data) + globe projection. Real
// streets, place/street labels and country borders that resolve at every zoom.
const GLOBE_STYLE = {
  version: 8 as const,
  projection: { type: "globe" as const },
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster" as const, source: "carto" }],
};

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// Minimal HTML escape for values interpolated into the hover-popup markup.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Densify a segment into points along the great circle so it hugs the globe.
function greatCircle(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  n = 64,
): Array<[number, number]> {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lng);
  const lat2 = toRad(end.lat);
  const lon2 = toRad(end.lng);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (!Number.isFinite(d) || d === 0) {
    return [
      [start.lng, start.lat],
      [end.lng, end.lat],
    ];
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return out;
}

function popupHTML(p: GlobePoint): string {
  const color = KIND_COLORS[p.kind] ?? KIND_COLORS.default;
  const img = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="" style="width:168px;height:96px;object-fit:cover;display:block;border-radius:8px 8px 0 0;" onerror="this.style.display='none'"/>`
    : "";
  return `<div style="width:168px;border-radius:8px;overflow:hidden;background:rgba(13,16,24,0.96);border:1px solid ${color};box-shadow:0 6px 20px rgba(0,0,0,0.5);font-family:ui-sans-serif,system-ui,sans-serif;">${img}<div style="padding:6px 9px;display:flex;align-items:center;gap:6px;"><span style="flex:none;width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};"></span><span style="font-size:12px;line-height:1.25;color:#f5efe3;">${esc(p.label)}</span></div></div>`;
}

export function TripGlobe({
  points,
  arcs,
  focus,
  onPointClick,
  className,
}: TripGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Map instance + markers kept in refs (module dynamically imported, so we type
  // these loosely rather than referencing maplibre types at module scope).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  const interactedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep the latest onPointClick without re-running the marker effect.
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  // ── Create the map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (disposed || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: GLOBE_STYLE,
          center: [0, 20],
          zoom: 1.1,
          attributionControl: false,
          dragRotate: true,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.AttributionControl({ compact: true }));

        map.on("load", () => {
          if (disposed) return;
          try {
            map.setProjection({ type: "globe" });
          } catch {
            /* older builds → falls back to mercator, still resolves on zoom */
          }
          // Arc layers (filled by the points/arcs effect via setData).
          map.addSource("trip-route", { type: "geojson", data: EMPTY_FC });
          map.addLayer({
            id: "trip-route-line",
            type: "line",
            source: "trip-route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ROUTE_COLOR,
              "line-width": 2,
              "line-opacity": 0.85,
              "line-blur": 0.4,
            },
          });
          map.addSource("trip-flight", { type: "geojson", data: EMPTY_FC });
          map.addLayer({
            id: "trip-flight-line",
            type: "line",
            source: "trip-flight",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": FLIGHT_COLOR,
              "line-width": 1.8,
              "line-opacity": 0.85,
              "line-blur": 0.4,
              "line-dasharray": [2, 1.5],
            },
          });
          setReady(true);
        });

        const stop = () => {
          interactedRef.current = true;
        };
        map.on("mousedown", stop);
        map.on("touchstart", stop);
        map.on("wheel", stop);
        map.on("dragstart", stop);
        map.on("error", () => {
          if (!disposed) setFailed(true);
        });

        // Resize with the container (the pane is responsive width).
        ro = new ResizeObserver(() => {
          try {
            map.resize();
          } catch {
            /* ignore */
          }
        });
        ro.observe(containerRef.current);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (ro) ro.disconnect();
      markersRef.current.forEach((m) => {
        try {
          m.remove();
        } catch {
          /* ignore */
        }
      });
      markersRef.current = [];
      try {
        if (map) map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Markers + arcs (rebuild when data changes) ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !mapRef.current) return;

      // Clear old markers.
      markersRef.current.forEach((m) => {
        try {
          m.remove();
        } catch {
          /* ignore */
        }
      });
      markersRef.current = [];

      // Markers (small, crisp DOM dots) + hover popups.
      for (const p of points) {
        const color = KIND_COLORS[p.kind] ?? KIND_COLORS.default;
        const el = document.createElement("div");
        el.style.cssText = `width:11px;height:11px;border-radius:50%;background:${color};border:1.5px solid #0d1018;box-shadow:0 0 0 1.5px ${color}55,0 1px 3px rgba(0,0,0,0.5);cursor:pointer;`;
        const popup = new maplibregl.Popup({
          offset: 12,
          closeButton: false,
          className: "trip-globe-popup",
        }).setHTML(popupHTML(p));
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        el.addEventListener("mouseenter", () => {
          popup.setLngLat([p.lng, p.lat]).addTo(map);
        });
        el.addEventListener("mouseleave", () => {
          popup.remove();
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          clickRef.current?.(p.id);
        });
        markersRef.current.push(marker);
      }

      // Arc lines (densified great circles), split by kind.
      const route: object[] = [];
      const flight: object[] = [];
      for (const a of arcs) {
        // Prefer a real route path (decoded Directions polyline); else great-circle.
        const coords =
          a.path && a.path.length >= 2
            ? a.path
            : greatCircle(
                { lat: a.startLat, lng: a.startLng },
                { lat: a.endLat, lng: a.endLng },
              );
        const feature = {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        };
        (a.kind === "flight" ? flight : route).push(feature);
      }
      const setData = (id: string, features: object[]) => {
        const src = map.getSource(id);
        if (src && typeof src.setData === "function") {
          src.setData({ type: "FeatureCollection", features });
        }
      };
      setData("trip-route", route);
      setData("trip-flight", flight);
    })();

    return () => {
      cancelled = true;
    };
  }, [points, arcs, ready]);

  // ── Auto-FRAME all stops on a new trip's points ────────────────────────────
  const pointsKey = useMemo(() => points.map((p) => p.id).join("|"), [points]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (focus) return; // explicit focus wins
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 9, duration: 1200 });
      return;
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const p of points) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    try {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, maxZoom: 11, duration: 1200 },
      );
    } catch {
      /* degenerate bounds → ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, ready]);

  // ── Fly-to on focus change ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    interactedRef.current = true;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom?.() ?? 0, 7),
      duration: 1000,
    });
  }, [focus?.lat, focus?.lng, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = "relative h-full w-full overflow-hidden";
  const cls = className ? `${base} ${className}` : base;

  if (failed) {
    return (
      <div className={cls} role="img" aria-label="Trip globe (unavailable)">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <span className="text-xs text-paper/50">Globe unavailable</span>
          {points.length > 0 && (
            <ul className="max-h-full space-y-0.5 overflow-auto text-[11px] text-paper/40">
              {points.slice(0, 10).map((p) => (
                <li key={p.id}>• {p.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cls}>
      {/* Dark-theme popup chrome (transparent wrapper; our card carries the styling). */}
      <style>{`.trip-globe-popup .maplibregl-popup-content{background:transparent;padding:0;box-shadow:none;border:none;}.trip-globe-popup .maplibregl-popup-tip{display:none;}`}</style>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export default TripGlobe;
