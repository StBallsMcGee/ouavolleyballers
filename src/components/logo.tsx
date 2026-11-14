/** Sideout's logo: a stylised yellow volleyball with blue seams. */
export function VolleyballLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="Sideout">
      <defs>
        <radialGradient id="vb-fill" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="45%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#eab308" />
        </radialGradient>
        <clipPath id="vb-clip"><circle cx="32" cy="32" r="28" /></clipPath>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#vb-fill)" />
      <g clipPath="url(#vb-clip)" fill="none" stroke="#1f5bcc" strokeWidth="3.4" strokeLinecap="round">
        {/* Three panels swirling out from the centre, each with a parallel seam. */}
        <path d="M32 32 C 31 20, 37 10, 49 6" />
        <path d="M24 29 C 21 18, 26 8, 36 3" stroke="#5b8def" strokeWidth="2.6" />
        <path d="M32 32 C 21 38, 11 37, 3 30" />
        <path d="M34 40 C 23 47, 11 46, 3 40" stroke="#5b8def" strokeWidth="2.6" />
        <path d="M32 32 C 43 35, 50 45, 50 59" />
        <path d="M40 27 C 52 30, 60 41, 61 52" stroke="#5b8def" strokeWidth="2.6" />
      </g>
      <circle cx="32" cy="32" r="28" fill="none" stroke="#173c85" strokeWidth="3" />
      <ellipse cx="23" cy="18" rx="7" ry="4" fill="#fff" opacity="0.35" transform="rotate(-30 23 18)" />
    </svg>
  );
}

/** The same drawing as plain SVG text (for app icons). */
export const VOLLEYBALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="f" cx="38%" cy="32%" r="70%"><stop offset="0%" stop-color="#fff3b0"/><stop offset="45%" stop-color="#fcd34d"/><stop offset="100%" stop-color="#eab308"/></radialGradient><clipPath id="c"><circle cx="32" cy="32" r="28"/></clipPath></defs><circle cx="32" cy="32" r="28" fill="url(#f)"/><g clip-path="url(#c)" fill="none" stroke="#1f5bcc" stroke-width="3.4" stroke-linecap="round"><path d="M32 32 C 31 20, 37 10, 49 6"/><path d="M24 29 C 21 18, 26 8, 36 3" stroke="#5b8def" stroke-width="2.6"/><path d="M32 32 C 21 38, 11 37, 3 30"/><path d="M34 40 C 23 47, 11 46, 3 40" stroke="#5b8def" stroke-width="2.6"/><path d="M32 32 C 43 35, 50 45, 50 59"/><path d="M40 27 C 52 30, 60 41, 61 52" stroke="#5b8def" stroke-width="2.6"/></g><circle cx="32" cy="32" r="28" fill="none" stroke="#173c85" stroke-width="3"/><ellipse cx="23" cy="18" rx="7" ry="4" fill="#fff" opacity="0.35" transform="rotate(-30 23 18)"/></svg>`;
