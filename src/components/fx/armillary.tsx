import { cn } from "@/lib/utils";

/**
 * Brass wireframe armillary sphere — pure CSS 3D (no WebGL, no deps).
 * Five rings on offset axes inside a slowly precessing sphere, a glowing
 * core, and one orbiting satellite. Recolors with the accent variable.
 */
export function Armillary({
  size = 190,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("armillary", className)}
      style={{ width: size, height: size }}
    >
      <div className="armillary-glow" />
      <div className="armillary-sphere">
        <div className="armillary-ring r1" />
        <div className="armillary-ring r2" />
        <div className="armillary-ring r3" />
        <div className="armillary-ring r4" />
        <div className="armillary-ring r5" />
        <div className="armillary-core" />
      </div>
      <div className="armillary-orbit">
        <span className="armillary-planet" />
      </div>
    </div>
  );
}
