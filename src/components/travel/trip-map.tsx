"use client";

/**
 * TripMap — a small embedded MapLibre map for the travel widget.
 *
 * No token: uses a free demo style (MapLibre's hosted demotiles vector style,
 * which is built on CARTO-style basemaps). Renders markers colored by `kind`,
 * optional per-route polylines, and fitBounds to all markers.
 *
 * SSR SAFETY (critical):
 *  - "use client" so this file is never evaluated during server rendering.
 *  - maplibre-gl is touched ONLY inside a useEffect via a DYNAMIC import — it is
 *    never imported at module top, so Next's static generation / SSR pass never
 *    references `window`. (maplibre dereferences `window` at import time.)
 *  - The CSS is imported statically (stylesheet imports are SSR-safe).
 *  - If the map fails to load/init for any reason, a graceful fallback div with
 *    a marker list is shown instead of crashing.
 */

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export type MarkerKind =
  | "lodging"
  | "food"
  | "sight"
  | "transport"
  | "activity"
  | "origin"
  | "destination"
  | "default";

export interface TripMarker {
  lat: number;
  lng: number;
  label: string;
  kind?: MarkerKind;
}

export interface TripMapProps {
  markers: TripMarker[];
  /** Optional polylines; each route is an ordered list of {lat,lng}. */
  routes?: Array<Array<{ lat: number; lng: number }>>;
  className?: string;
}

// Marker dot color by kind (tailwind-independent inline hex so it works on canvas).
const KIND_COLORS: Record<MarkerKind, string> = {
  lodging: "#7c3aed", // violet
  food: "#f97316", // orange
  sight: "#0ea5e9", // sky
  transport: "#64748b", // slate
  activity: "#10b981", // emerald
  origin: "#22c55e", // green
  destination: "#ef4444", // red
  default: "#b08d57", // brass (hub accent)
};

// No-token demo style (MapLibre hosted). CARTO-style basemap, no API key.
const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";

export function TripMap({ markers, routes, className }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Map instance kept in a ref to avoid re-renders; typed loosely (module is
  // dynamically imported so we can't reference its types at module scope here).
  const mapRef = useRef<unknown>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Guard: never run on the server (defensive — effects are client-only anyway).
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;
    if (markers.length === 0) return;

    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any = null;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (disposed || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: DEMO_STYLE,
          center: [markers[0].lng, markers[0].lat],
          zoom: 9,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.AttributionControl({ compact: true }));

        map.on("load", () => {
          if (disposed) return;

          // Draw route polylines first (under markers).
          (routes ?? []).forEach((route, i) => {
            if (route.length < 2) return;
            const id = `trip-route-${i}`;
            try {
              map.addSource(id, {
                type: "geojson",
                data: {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: route.map((p) => [p.lng, p.lat]),
                  },
                },
              });
              map.addLayer({
                id,
                type: "line",
                source: id,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                  "line-color": "#b08d57",
                  "line-width": 3,
                  "line-opacity": 0.7,
                },
              });
            } catch {
              /* a bad route shouldn't kill the map */
            }
          });

          // Markers, colored by kind.
          for (const m of markers) {
            const color = KIND_COLORS[m.kind ?? "default"] ?? KIND_COLORS.default;
            const el = document.createElement("div");
            el.style.width = "14px";
            el.style.height = "14px";
            el.style.borderRadius = "50%";
            el.style.background = color;
            el.style.border = "2px solid #fff";
            el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
            el.style.cursor = "pointer";
            const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setText(
              m.label,
            );
            new maplibregl.Marker({ element: el })
              .setLngLat([m.lng, m.lat])
              .setPopup(popup)
              .addTo(map);
          }

          // fitBounds to all markers (skip for a single marker — already centered).
          if (markers.length > 1) {
            const bounds = new maplibregl.LngLatBounds();
            for (const m of markers) bounds.extend([m.lng, m.lat]);
            try {
              map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
            } catch {
              /* ignore degenerate bounds */
            }
          }
        });

        map.on("error", () => {
          // Style/tile errors shouldn't blank the widget.
          if (!disposed) setFailed(true);
        });
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      try {
        if (map) map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
    // Re-init when the marker/route inputs change.
  }, [markers, routes]);

  const base =
    "relative w-full h-full min-h-[180px] rounded-lg overflow-hidden bg-paper/[0.04]";
  const cls = className ? `${base} ${className}` : base;

  if (failed || markers.length === 0) {
    return (
      <div className={cls} role="img" aria-label="Trip map (unavailable)">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <span className="text-xs text-paper/50">
            {markers.length === 0 ? "No locations yet" : "Map unavailable"}
          </span>
          {markers.length > 0 && (
            <ul className="text-[11px] text-paper/40 space-y-0.5 max-h-full overflow-auto">
              {markers.slice(0, 8).map((m, i) => (
                <li key={i}>• {m.label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={cls} />;
}

export default TripMap;
