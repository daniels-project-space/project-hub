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
 *  - pointsData markers colored by `kind`, with rich hover cards (image + title).
 *  - arcsData animated glowing arcs between consecutive ordered stops.
 *  - country borders (polygonsData) hugging the surface for orientation, plus
 *    country name labels that fade in only once the camera is zoomed in.
 *  - controls().autoRotate = true (slow) until the user interacts, then stops.
 *  - on a new trip's points → auto-frames the camera to FIT all stops (jumps to
 *    that part of the globe and zooms so the whole itinerary fills the view).
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
  /** Optional photo of the place — shown in the hover card on the globe. */
  imageUrl?: string;
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

// Country borders (Natural Earth 110m) — fetched once on the client from a CDN.
// Drives the country outlines + name labels. If the fetch fails the globe still
// renders fine (polygons/labels just stay empty), so it's purely additive.
const COUNTRIES_GEOJSON =
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";

// Below this camera altitude we consider the globe "zoomed in" and reveal the
// country name labels (kept hidden when zoomed out to avoid a cluttered planet).
const LABEL_ZOOM_THRESHOLD = 1.3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountryFeature = any;
interface CountryLabel {
  text: string;
  lat: number;
  lng: number;
}

// Minimal HTML escape for values interpolated into the hover-card markup.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Great-circle angular distance between two lat/lng points, in degrees.
function angularDistanceDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 180) / Math.PI;
}

// Camera altitude (in globe-radius units) that frames all points so the whole
// itinerary fills the view. Derived from the camera's visible angular radius:
// at distance R(1+h) the horizon half-angle β satisfies cos(β)=1/(1+h), so to
// fit a cluster spanning angular radius β we set h = 1/cos(β) - 1 (with padding).
function fitAltitude(pts: GlobePoint[], lat: number, lng: number): number {
  if (pts.length === 0) return 2.2;
  let maxAng = 0;
  for (const p of pts) {
    maxAng = Math.max(maxAng, angularDistanceDeg(lat, lng, p.lat, p.lng));
  }
  // Single stop or a very tight cluster → a close, comfortable zoom.
  if (pts.length === 1 || maxAng < 1.5) return 0.75;
  const betaDeg = Math.min(82, maxAng * 1.25 + 6); // padding so dots aren't on the rim
  const beta = (betaDeg * Math.PI) / 180;
  const h = 1 / Math.cos(beta) - 1;
  return Math.min(2.8, Math.max(0.5, h));
}

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

  // ── Country borders (fetched once, client-side) ───────────────────────────
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_GEOJSON)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && Array.isArray(j.features)) {
          setCountries(j.features as CountryFeature[]);
        }
      })
      .catch(() => {
        /* offline / blocked → globe still renders without borders */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Country name labels, placed at Natural Earth's LABEL_X/Y when present.
  const countryLabels = useMemo<CountryLabel[]>(() => {
    const out: CountryLabel[] = [];
    for (const f of countries) {
      const p = f?.properties ?? {};
      const text: string | undefined = p.NAME ?? p.name ?? p.ADMIN;
      const lng = typeof p.LABEL_X === "number" ? p.LABEL_X : undefined;
      const lat = typeof p.LABEL_Y === "number" ? p.LABEL_Y : undefined;
      if (text && lat != null && lng != null) out.push({ text, lat, lng });
    }
    return out;
  }, [countries]);

  // ── Reveal labels only when zoomed in (driven by onZoom) ───────────────────
  const [zoomedIn, setZoomedIn] = useState(false);
  const zoomedInRef = useRef(false);
  const visibleLabels = zoomedIn ? countryLabels : [];

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
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 0.9 }, 1000);
  }, [focus?.lat, focus?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-FRAME all stops on a new trip's points ────────────────────────────
  // Re-runs whenever the actual set of points changes (keyed by ids, not just
  // count) so loading a different trip jumps + zooms to fit its whole itinerary.
  // Retries briefly until the globe instance exists (points often arrive before
  // the ref is populated). Skipped while an explicit focus is active.
  const pointsKey = useMemo(() => points.map((p) => p.id).join("|"), [points]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (focus) return; // explicit focus wins
    if (points.length === 0) return;
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    const altitude = fitAltitude(points, lat, lng);
    let raf = 0;
    let tries = 0;
    const arm = () => {
      const g = globeRef.current;
      if (g) {
        g.pointOfView({ lat, lng, altitude }, 1200);
        return;
      }
      if (tries++ < 90) raf = requestAnimationFrame(arm);
    };
    raf = requestAnimationFrame(arm);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey]);

  const arcColor = useMemo(
    () => (a: object) =>
      (a as GlobeArc).kind === "flight" ? FLIGHT_ARC_COLOR : ROUTE_ARC_COLOR,
    [],
  );

  // Rich hover card: place image (if any) + colored title.
  const pointLabel = useMemo(
    () => (d: object) => {
      const p = d as GlobePoint;
      const color = KIND_COLORS[p.kind] ?? KIND_COLORS.default;
      const img = p.imageUrl
        ? `<img src="${esc(p.imageUrl)}" alt="" style="width:168px;height:96px;object-fit:cover;display:block;border-radius:8px 8px 0 0;" onerror="this.style.display='none'"/>`
        : "";
      return `<div style="width:168px;border-radius:8px;overflow:hidden;background:rgba(13,16,24,0.94);border:1px solid ${color};box-shadow:0 6px 20px rgba(0,0,0,0.5);font-family:ui-sans-serif,system-ui,sans-serif;">${img}<div style="padding:6px 9px;display:flex;align-items:center;gap:6px;"><span style="flex:none;width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};"></span><span style="font-size:12px;line-height:1.25;color:#f5efe3;">${esc(p.label)}</span></div></div>`;
    },
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
          onZoom={(pov: { altitude?: number }) => {
            const show = (pov?.altitude ?? 99) < LABEL_ZOOM_THRESHOLD;
            // Only re-render when the threshold is actually crossed (onZoom fires
            // every frame while moving — guarding avoids a setState storm).
            if (show !== zoomedInRef.current) {
              zoomedInRef.current = show;
              setZoomedIn(show);
            }
          }}
          // Country borders (subtle outlines hugging the surface)
          polygonsData={countries as unknown as object[]}
          polygonCapColor={() => "rgba(0,0,0,0)"}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={() => "rgba(176,141,87,0.45)"}
          polygonAltitude={0.006}
          // Country name labels (revealed only when zoomed in)
          labelsData={visibleLabels as unknown as object[]}
          labelLat={(d: object) => (d as CountryLabel).lat}
          labelLng={(d: object) => (d as CountryLabel).lng}
          labelText={(d: object) => (d as CountryLabel).text}
          labelSize={0.9}
          labelDotRadius={0.18}
          labelColor={() => "rgba(245,239,227,0.78)"}
          labelResolution={2}
          labelAltitude={0.008}
          // Points
          pointsData={points as unknown as object[]}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointColor={(d: object) =>
            KIND_COLORS[(d as GlobePoint).kind] ?? KIND_COLORS.default
          }
          pointAltitude={0.012}
          pointRadius={0.14}
          pointResolution={12}
          pointLabel={pointLabel}
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
