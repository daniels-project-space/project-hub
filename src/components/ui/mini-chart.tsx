import { cn } from "@/lib/utils";

// Tiny dependency-free SVG sparkline.
export function MiniChart({
  data,
  width = 120,
  height = 32,
  strokeColor = "var(--color-brass)",
  fill = true,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fill?: boolean;
  className?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const n = data.length;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const y = pad + h - ((d - min) / range) * h;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const area =
    `${line} L${points[n - 1][0].toFixed(2)},${(height - pad).toFixed(2)}` +
    ` L${points[0][0].toFixed(2)},${(height - pad).toFixed(2)} Z`;

  const gid = `mc-${Math.round(width)}-${Math.round(height)}-${n}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} stroke="none" />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
