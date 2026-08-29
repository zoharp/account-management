/**
 * The Orcanos mark — an open arc with the orange dot closing it.
 *
 * Copied verbatim from traceability-matrix (`src/frontend/src/App.jsx`) so the
 * two apps show the same logo; if that path changes, change it here too.
 *
 * The arc inherits `currentColor` so a caller can place it on any background;
 * the dot is fixed (`--logo-dot`). That dot is #f5821f, NOT the design system's
 * `--accent-orange` #f5a623 — it is part of the mark, so it matches the other
 * app rather than the palette.
 */
export default function OrcanosLogo({ className = '' }: { className?: string }) {
  return (
    <svg className={`orcanos-logo ${className}`.trim()} viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M 33.94 15.56 A 38 38 0 1 1 14.29 37.00"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <circle cx="21.98" cy="24.33" r="8" fill="var(--logo-dot)" />
    </svg>
  );
}
