"use client";

/**
 * TripGlobe — an interactive animated 3D globe for the expanded trip view
 * (Stage 5). Thin wrapper over react-globe.gl (which wraps three.js / globe.gl).
 *
 * SSR SAFETY (critical):
 *  - react-globe.gl references `window`/`document` at IMPORT time, so this whole
 *    module MUST only ever be loaded on the client. The ONLY allowed entry is a
 *    `next/dynamic(() => import("@/components/travel/trip-globe"), { ssr:false })`
 *    in the consumer. No file that is SSR/statically rendered may import this
 *    statically. Because the dynamic import defers evaluation to the browser,
 *    importing react-globe.gl at this module's top is safe.
 *  - "use client" marks the boundary; all three/globe usage stays inside here.
 *
 * Behavior:
 *  - pointsData markers colored by `kind`, with hover labels.
 *  - arcsData animated glowing arcs between consecutive ordered stops.
 *  - controls().autoRotate = true (slow) until the user interacts, then stops.
 *  - `focus` change → animated fly-to via globeRef.pointOfView(...).
 *  - Sizes to its container via a ResizeObserver (width/height props are exact px).
 *  - Empty points → still renders a calm auto-rotating earth (no crash).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";

// ── Public types ────────────────────────────────────────────────────────────
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
}

export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  /** Optional kind to tint the arc (e.g. "flight" vs the default route). */
  kind?: "route" | "flight";
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

// Marker dot color by kind (inline hex — drawn on a WebGL canvas, not via CSS).
const KIND_COLORS: Record<GlobePointKind, string> = {
  place: "#0ea5e9", // sky
  food: "#f97316", // orange
  stay: "#7c3aed", // violet
  flight: "#38bdf8", // light sky
  transport: "#64748b", // slate
  activity: "#10b981", // emerald
  leg: "#b08d57", // brass (hub accent) — multi-destination legs
  default: "#b08d57",
};

// Glowing arc gradients (two-stop arrays animate along the arc).
const ROUTE_ARC_COLOR = ["#b08d57", "#f5d9a8"]; // brass → warm
const FLIGHT_ARC_COLOR = ["#38bdf8", "#bae6fd"]; // sky → pale

// No-token night-earth texture (unpkg CDN that ships with three-globe examples).
const GLOBE_IMG =
  "https://unpkg.com/three-globe/example/img/earth-night.jpg";
const BUMP_IMG = "https://unpkg.com/three-globe/example/img/earth-topology.png";

export function TripGlobe({
  points,
  arcs,
  focus,
  onPointClick,
  className,
}: TripGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const interactedRef = useRef(false);

  // ── Size to container (ResizeObserver) ────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Autorotate until first interaction ────────────────────────────────────
  // Set up once the globe instance exists. We poll briefly for controls() since
  // the ref is populated after the first internal mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    let tries = 0;
    const arm = () => {
      const g = globeRef.current;
      const controls = g?.controls?.();
      if (controls) {
        controls.autoRotate = !interactedRef.current;
        controls.autoRotateSpeed = 0.35; // slow
        const stop = () => {
          interactedRef.current = true;
          controls.autoRotate = false;
        };
        controls.addEventListener("start", stop);
        return;
      }
      if (tries++ < 60) raf = requestAnimationFrame(arm);
    };
    raf = requestAnimationFrame(arm);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  // ── Fly-to on focus change ────────────────────────────────────────────────
  useEffect(() => {
    if (!focus) return;
    const g = globeRef.current;
    if (!g) return;
    // Treating a fly-to as an interaction so we don't fight the camera.
    interactedRef.current = true;
    const controls = g.controls?.();
    if (controls) controls.autoRotate = false;
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 1.6 }, 1000);
  }, [focus?.lat, focus?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initial framing once points exist ─────────────────────────────────────
  useEffect(() => {
    if (focus) return; // explicit focus wins
    const g = globeRef.current;
    if (!g || points.length === 0) return;
    // Center on the centroid of the points at a comfortable altitude.
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    g.pointOfView({ lat, lng, altitude: 2.2 }, 800);
    // Only on first meaningful points set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  const arcColor = useMemo(
    () => (a: object) =>
      (a as GlobeArc).kind === "flight" ? FLIGHT_ARC_COLOR : ROUTE_ARC_COLOR,
    [],
  );

  return (
    <div
      ref={wrapRef}
      className={
        className
          ? `relative h-full w-full overflow-hidden ${className}`
          : "relative h-full w-full overflow-hidden"
      }
    >
      {size.w > 0 && size.h > 0 && (
        <Globe
          ref={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={GLOBE_IMG}
          bumpImageUrl={BUMP_IMG}
          showAtmosphere
          atmosphereColor="#9ec5ff"
          atmosphereAltitude={0.18}
          // Points
          pointsData={points as unknown as object[]}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointColor={(d: object) =>
            KIND_COLORS[(d as GlobePoint).kind] ?? KIND_COLORS.default
          }
          pointAltitude={0.02}
          pointRadius={0.32}
          pointResolution={12}
          pointLabel={(d: object) => (d as GlobePoint).label}
          onPointClick={(d: object) =>
            onPointClick?.((d as GlobePoint).id)
          }
          // Arcs
          arcsData={arcs as unknown as object[]}
          arcStartLat={(d: object) => (d as GlobeArc).startLat}
          arcStartLng={(d: object) => (d as GlobeArc).startLng}
          arcEndLat={(d: object) => (d as GlobeArc).endLat}
          arcEndLng={(d: object) => (d as GlobeArc).endLng}
          arcColor={arcColor}
          arcStroke={0.5}
          arcAltitudeAutoScale={0.4}
          arcDashLength={0.4}
          arcDashGap={0.18}
          arcDashAnimateTime={2200}
        />
      )}
    </div>
  );
}

export default TripGlobe;
