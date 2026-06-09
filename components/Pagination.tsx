"use client";

// Reusable pagination component (Foundation-wide).
//
// Controlled component: caller owns `page` + `pageSize` state and decides
// whether to paginate client-side (slice the array) or server-side (request
// the next page from the BFF). This component just emits change events.
//
// Features:
//   - Page-size selector (default: 10 / 25 / 50 / 100)
//   - First / Prev / numbered pages with ellipsis / Next / Last
//   - "Showing X-Y of Z entries" range hint
//   - Brand-coloured active page, hover + focus states
//   - Disabled state on edge buttons
//   - Auto-collapse to "all pages" when totalPages <= 7
//   - Configurable item label ("entries", "users", "logs", "rows", ...)
//   - Stays usable down to ~360px viewport (wraps onto two rows)
//
// Usage:
//   const [page, setPage] = useState(1);
//   const [pageSize, setPageSize] = useState(25);
//   const slice = items.slice((page - 1) * pageSize, page * pageSize);
//   ...
//   <Pagination
//     page={page}
//     pageSize={pageSize}
//     total={items.length}
//     onPageChange={setPage}
//     onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
//   />

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  /** 1-based current page. Clamped to [1, totalPages] internally. */
  page: number;
  /** Items per page. Should be one of `pageSizeOptions`. */
  pageSize: number;
  /** Total item count across all pages. */
  total: number;
  /** Called with the new 1-based page when the user changes pages. */
  onPageChange: (page: number) => void;
  /** Called with the new page size when the user picks a different size. */
  onPageSizeChange?: (size: number) => void;
  /** Override the default [10, 25, 50, 100] options. */
  pageSizeOptions?: readonly number[];
  /** Hide the page-size selector entirely (e.g. fixed page size). */
  hidePageSizeSelector?: boolean;
  /** Word for the rendered count - "entries" by default. */
  itemLabel?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  hidePageSizeSelector = false,
  itemLabel = "entries",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const firstItem = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(safePage * pageSize, total);

  const range = paginationRange(safePage, totalPages);

  const goTo = (target: number) => {
    const clamped = Math.min(Math.max(1, target), totalPages);
    if (clamped !== safePage) onPageChange(clamped);
  };

  const showSizeSelector = !hidePageSizeSelector && typeof onPageSizeChange === "function";

  return (
    <div style={containerStyle}>
      {/* Left: page-size selector + range hint */}
      <div style={leftGroupStyle}>
        {showSizeSelector && (
          <div style={selectorWrapStyle}>
            <span style={mutedLabelStyle}>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                onPageSizeChange!(next);
                // Reset to page 1 so the user never lands on an out-of-range page
                // after shrinking total pages.
                if (safePage !== 1) onPageChange(1);
              }}
              style={selectStyle}
              aria-label={`${itemLabel} per page`}
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span style={mutedLabelStyle}>per page</span>
          </div>
        )}
        <span style={rangeLabelStyle}>
          {total === 0
            ? `No ${itemLabel}`
            : `Showing ${firstItem.toLocaleString()}–${lastItem.toLocaleString()} of ${total.toLocaleString()} ${itemLabel}`}
        </span>
      </div>

      {/* Right: navigation. Hide entirely when there is only one page. */}
      {totalPages > 1 && (
        <nav aria-label="Pagination" style={navGroupStyle}>
          <NavButton onClick={() => goTo(1)} disabled={safePage === 1} title="First page" aria-label="First page">
            <ChevronsLeft size={14} />
          </NavButton>
          <NavButton onClick={() => goTo(safePage - 1)} disabled={safePage === 1} title="Previous page" aria-label="Previous page">
            <ChevronLeft size={14} />
          </NavButton>

          {range.map((item, idx) =>
            item === "..." ? (
              <span key={`gap-${idx}`} style={ellipsisStyle} aria-hidden>…</span>
            ) : (
              <NumberButton
                key={item}
                active={item === safePage}
                onClick={() => goTo(item)}
                aria-label={`Page ${item}${item === safePage ? " (current)" : ""}`}
                aria-current={item === safePage ? "page" : undefined}
              >
                {item}
              </NumberButton>
            )
          )}

          <NavButton onClick={() => goTo(safePage + 1)} disabled={safePage === totalPages} title="Next page" aria-label="Next page">
            <ChevronRight size={14} />
          </NavButton>
          <NavButton onClick={() => goTo(totalPages)} disabled={safePage === totalPages} title="Last page" aria-label="Last page">
            <ChevronsRight size={14} />
          </NavButton>
        </nav>
      )}
    </div>
  );
}

/**
 * Helper exposed for callers that want to compute the visible slice without
 * re-implementing the safe-page logic.
 *   const { pageItems, totalPages } = paginate(allItems, page, pageSize);
 */
export function paginate<T>(items: T[], page: number, pageSize: number): {
  pageItems: T[];
  totalPages: number;
  safePage: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages, safePage };
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Build the list of page numbers + ellipses to render. Examples:
 *   range(1, 5)   -> [1, 2, 3, 4, 5]
 *   range(1, 12)  -> [1, 2, ..., 12]
 *   range(6, 12)  -> [1, ..., 5, 6, 7, ..., 12]
 *   range(12, 12) -> [1, ..., 11, 12]
 */
function paginationRange(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const siblings = 1;
  const left = Math.max(2, currentPage - siblings);
  const right = Math.min(totalPages - 1, currentPage + siblings);
  const out: (number | "...")[] = [1];
  if (left > 2) out.push("...");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < totalPages - 1) out.push("...");
  out.push(totalPages);
  return out;
}

function NavButton({ children, onClick, disabled, title, "aria-label": ariaLabel }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "1.5px solid #e5e7eb",
        background: "white",
        color: disabled ? "#d1d5db" : "#374151",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 140ms, color 140ms, border-color 140ms, transform 80ms",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "#f8f9fc";
        e.currentTarget.style.borderColor = "var(--brand-accent)";
        e.currentTarget.style.color = "var(--brand-primary)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "white";
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.color = "#374151";
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {children}
    </button>
  );
}

function NumberButton({ children, active, onClick, "aria-label": ariaLabel, "aria-current": ariaCurrent }: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      style={{
        minWidth: "32px",
        height: "32px",
        padding: "0 10px",
        borderRadius: "8px",
        border: active ? "none" : "1.5px solid #e5e7eb",
        background: active
          ? "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))"
          : "white",
        color: active ? "white" : "#374151",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "'Poppins', sans-serif",
        boxShadow: active ? "0 2px 10px rgba(27,42,74,0.25)" : "none",
        transition: "background 140ms, color 140ms, border-color 140ms, transform 80ms",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "#f8f9fc";
        e.currentTarget.style.borderColor = "var(--brand-accent)";
        e.currentTarget.style.color = "var(--brand-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "white";
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.color = "#374151";
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {children}
    </button>
  );
}

// ─── Style tokens ───────────────────────────────────────────────────────────
const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "14px 18px",
  borderTop: "1px solid #eef0f4",
  flexWrap: "wrap",
  fontFamily: "'Poppins', sans-serif",
  background: "white",
};

const leftGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "20px",
  flexWrap: "wrap",
};

const navGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

const selectorWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const selectStyle: React.CSSProperties = {
  padding: "7px 28px 7px 10px",
  border: "1.5px solid #e5e7eb",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#374151",
  background:
    "white url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path fill='%236b7280' d='M6 8L2 4h8z'/></svg>\") no-repeat right 8px center / 12px 12px",
  cursor: "pointer",
  fontFamily: "'Poppins', sans-serif",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
};

const mutedLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  fontFamily: "'Poppins', sans-serif",
};

const rangeLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#9ca3af",
  fontFamily: "'Poppins', sans-serif",
};

const ellipsisStyle: React.CSSProperties = {
  padding: "0 4px",
  color: "#9ca3af",
  fontSize: "12px",
  fontFamily: "'Poppins', sans-serif",
  userSelect: "none",
};
