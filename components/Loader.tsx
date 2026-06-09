"use client";

// Reusable loaders + skeletons. Modern brand-tinted spinners and skeleton
// blocks designed for any async surface in the app.
//
// Components exported:
//
//   <Loader />              centred ring spinner, optional caption + pulse
//   <Skeleton />             generic shimmer block
//   <SkeletonRow />          <tr> with N shimmer cells for table loading
//
// All animations:
//   - Read --brand-primary / --brand-accent from CSS vars (theme-aware).
//   - GPU-friendly (transform + background-position only).
//   - Respect `prefers-reduced-motion` via the global rules in globals.css.

import { CSSProperties } from "react";

// ───────────────────────── Loader (ring spinner) ─────────────────────────────

export interface LoaderProps {
  /** "sm" 22px, "md" 40px (default), "lg" 64px. */
  size?: "sm" | "md" | "lg";
  /** Optional caption rendered under the spinner with a subtle pulse. */
  text?: string;
  /** When true, wraps in a vertically-centred container with min-height. */
  fullCenter?: boolean;
  /** Forwarded to the outer container. */
  style?: CSSProperties;
}

export function Loader({ size = "md", text, fullCenter = false, style }: LoaderProps) {
  const dim = size === "sm" ? 22 : size === "lg" ? 64 : 40;
  const stroke = size === "sm" ? 2 : size === "lg" ? 5 : 3.5;
  const captionSize = size === "sm" ? 11 : size === "lg" ? 14 : 12.5;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: size === "lg" ? "18px" : "12px",
        padding: fullCenter ? "56px 20px" : "0",
        minHeight: fullCenter ? "200px" : undefined,
        fontFamily: "'Poppins', sans-serif",
        ...style,
      }}
      role="status"
      aria-live="polite"
      aria-label={text ?? "Loading"}
    >
      <RingSpinner size={dim} stroke={stroke} />
      {text && (
        <div
          className="loader-text-pulse"
          style={{
            fontSize: `${captionSize}px`,
            color: "#6b7280",
            fontWeight: 500,
            letterSpacing: "0.3px",
            fontFamily: "'Poppins', sans-serif",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * Modern ring spinner: a thin track + a brand-gradient arc that revolves
 * via CSS transform. Pure SVG, GPU-accelerated, no layout thrash.
 */
function RingSpinner({ size, stroke }: { size: number; stroke: number }) {
  const r = (size - stroke) / 2;
  const c = Math.PI * 2 * r;
  // Visible arc length = 28% of the circumference - gives a clean comet trail.
  const arc = c * 0.28;
  // Generate a unique gradient id so multiple spinners on the same page do
  // not collide. Stable per render of this component instance is fine because
  // it does not need to persist across re-renders.
  const gid = `loader-grad-${size}-${stroke}`;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
      {/* Static background track */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#eef0f4"
          strokeWidth={stroke}
        />
      </svg>
      {/* Rotating gradient arc */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="loader-spin"
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand-accent)" />
            <stop offset="100%" stopColor="var(--brand-primary)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c - arc}`}
        />
      </svg>
    </div>
  );
}

// ───────────────────────────── Skeleton block ────────────────────────────────

export interface SkeletonProps {
  /** Any valid CSS width. Default "100%". */
  width?: string | number;
  /** Any valid CSS height. Default 14. */
  height?: string | number;
  /** Border-radius preset. */
  rounded?: "sm" | "md" | "lg" | "pill" | "full";
  /** Inline style override (margins etc). */
  style?: CSSProperties;
}

const RADIUS: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  pill: "999px",
  full: "9999px",
};

export function Skeleton({ width = "100%", height = 14, rounded = "md", style }: SkeletonProps) {
  return (
    <span
      className="skeleton-shimmer"
      aria-hidden
      style={{
        display: "block",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: RADIUS[rounded],
        ...style,
      }}
    />
  );
}

// ───────────────────────────── Skeleton row ──────────────────────────────────

export interface SkeletonColumn {
  /** Width of the skeleton bar inside the cell. Default "70%". */
  width?: string | number;
  /** Skeleton block height. Default 14. */
  height?: string | number;
  /** Variant: "text" (one bar) or "avatar+text" (circle + bar) or "pill". */
  variant?: "text" | "avatar+text" | "pill";
  /** Border-radius preset. Default "md". */
  rounded?: SkeletonProps["rounded"];
  /** Optional fixed cell width (CSS). Useful for aligning with real columns. */
  cellWidth?: string;
}

export interface SkeletonRowProps {
  /** Schema for each cell. */
  columns: SkeletonColumn[];
  /** Padding token applied to each <td>. Default matches our 12px/16px tables. */
  cellPadding?: string;
  /** Optional bottom border between rows. */
  borderBottom?: string;
}

/**
 * A single `<tr>` whose cells are skeleton placeholders. Use inside `<tbody>`
 * to mimic the real table while data is loading.
 */
export function SkeletonRow({
  columns,
  cellPadding = "14px 16px",
  borderBottom = "1px solid #f9fafb",
}: SkeletonRowProps) {
  return (
    <tr style={{ borderBottom }}>
      {columns.map((col, i) => (
        <td
          key={i}
          style={{
            padding: cellPadding,
            width: col.cellWidth,
            fontFamily: "'Poppins', sans-serif",
          }}
        >
          {col.variant === "avatar+text" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Skeleton width={32} height={32} rounded="full" />
              <Skeleton width={col.width ?? "60%"} height={col.height ?? 12} rounded={col.rounded ?? "md"} />
            </div>
          ) : col.variant === "pill" ? (
            <Skeleton
              width={col.width ?? 72}
              height={col.height ?? 22}
              rounded="pill"
            />
          ) : (
            <Skeleton
              width={col.width ?? "70%"}
              height={col.height ?? 12}
              rounded={col.rounded ?? "md"}
            />
          )}
        </td>
      ))}
    </tr>
  );
}

/**
 * Convenience: render N copies of the same SkeletonRow. Use when you want a
 * uniform fake list while loading.
 *
 *   <SkeletonRows rows={6} columns={[...]} />
 */
export function SkeletonRows({
  rows = 6,
  columns,
  cellPadding,
  borderBottom,
}: SkeletonRowProps & { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow
          key={i}
          columns={columns}
          cellPadding={cellPadding}
          borderBottom={borderBottom}
        />
      ))}
    </>
  );
}
