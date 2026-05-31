import { cn } from "@/lib/utils";

// Dependency-free SVG area+line chart.
// - Default (sparkline): tiny inline trend line, fill gradient.
// - "rich" mode: horizontal gridlines, right-aligned value-axis labels,
//   first/last x-axis labels, and an end-dot — matches v1's net-worth graph.
export function MiniChart({
  data,
  labels,
  width = 120,
  height = 32,
  strokeColor = "var(--color-brass)",
  fill = true,
  axis = false,
  endDot = false,
  className,
  valueFormat,
}: {
  data: number[];
  /** x-axis point labels (only first + last are drawn in axis mode). */
  labels?: string[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fill?: boolean;
  /** Draw gridlines + value-axis labels (rich net-worth-graph look). */
  axis?: boolean;
  /** Draw a dot at the latest point. */
  endDot?: boolean;
  className?: string;
  /** Formats the value-axis tick labels (e.g. £124.7k). */
  valueFormat?: (n: number) => string;
}) {
  if (!data || data.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  // 8% headroom like v1 so the line never kisses the edges.
  const rawRange = max - min || 1;
  const padY = axis ? rawRange * 0.08 : 0;
  const lo = min - padY;
  const hi = max + padY;
  const range = hi - lo || 1;

  const n = data.length;
  const pad = 2;
  // Leave room on the right for axis labels + a bottom strip for date labels.
  const padRight = axis ? 46 : pad;
  const padBottom = axis ? 18 : pad;
  const w = width - pad - padRight;
  const h = height - pad - padBottom;

  const xAt = (i: number) => pad + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (d: number) => pad + h - ((d - lo) / range) * h;

  const points = data.map((d, i) => [xAt(i), yAt(d)] as const);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area =
    `${line} L${points[n - 1][0].toFixed(2)},${(pad + h).toFixed(2)}` +
    ` L${points[0][0].toFixed(2)},${(pad + h).toFixed(2)} Z`;

  const gid = `mc-${Math.round(width)}-${Math.round(height)}-${n}`;
  const fmt = valueFormat ?? ((v: number) => `${(v / 1000).toFixed(1)}k`);

  // Gridline / axis ticks (4 rows top→bottom).
  const ticks = axis
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = hi - f * range;
        return { y: pad + f * h, v };
      })
    : [];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* gridlines + value labels */}
      {axis &&
        ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad}
              y1={t.y.toFixed(1)}
              x2={pad + w}
              y2={t.y.toFixed(1)}
              stroke="var(--color-brass)"
              strokeOpacity="0.07"
              strokeWidth="1"
            />
            <text
              x={pad + w + 6}
              y={t.y + 3}
              fill="var(--color-brass)"
              fillOpacity="0.38"
              fontFamily="var(--font-mono), monospace"
              fontSize="10"
            >
              {fmt(t.v)}
            </text>
          </g>
        ))}

      {fill && <path d={area} fill={`url(#${gid})`} stroke="none" />}

      <path
        d={line}
        fill="none"
        stroke={strokeColor}
        strokeWidth={axis ? 2 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* end dot at the latest point */}
      {endDot && (
        <circle
          cx={points[n - 1][0].toFixed(2)}
          cy={points[n - 1][1].toFixed(2)}
          r={axis ? 3 : 2.5}
          fill={strokeColor}
          stroke="var(--color-ink)"
          strokeWidth="2"
        />
      )}

      {/* x-axis date labels (first + last) */}
      {axis && labels && labels.length >= 2 && (
        <>
          <text
            x={pad}
            y={height - 4}
            fill="var(--color-brass)"
            fillOpacity="0.32"
            fontFamily="var(--font-mono), monospace"
            fontSize="10"
          >
            {labels[0]}
          </text>
          <text
            x={pad + w}
            y={height - 4}
            textAnchor="end"
            fill="var(--color-brass)"
            fillOpacity="0.32"
            fontFamily="var(--font-mono), monospace"
            fontSize="10"
          >
            {labels[labels.length - 1]}
          </text>
        </>
      )}
    </svg>
  );
}
