/**
 * A volleyball court seen from above, net running down the middle: the outer lines, the net
 * (with its posts) and the two attack lines, 3 m from the net on each 9 m half.
 */
export function CourtLines({ className = "", stroke = "rgba(255,255,255,0.75)", floor }: { className?: string; stroke?: string; floor?: string }) {
  return (
    <svg viewBox="0 0 200 100" preserveAspectRatio="none" className={className} aria-hidden>
      {floor ? <rect x="10" y="10" width="180" height="80" rx="2" fill={floor} /> : null}
      <g fill="none" stroke={stroke} strokeWidth="1.4" vectorEffect="non-scaling-stroke">
        <rect x="10" y="10" width="180" height="80" rx="1.5" />
        <line x1="70" y1="10" x2="70" y2="90" />
        <line x1="130" y1="10" x2="130" y2="90" />
      </g>
      {/* The net: a double line with posts beyond the sidelines. */}
      <g stroke={stroke} vectorEffect="non-scaling-stroke">
        <line x1="100" y1="4" x2="100" y2="96" strokeWidth="2.6" vectorEffect="non-scaling-stroke" />
        <line x1="101.6" y1="10" x2="101.6" y2="90" strokeWidth="0.8" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
      </g>
      <circle cx="100" cy="4" r="2" fill={stroke} />
      <circle cx="100" cy="96" r="2" fill={stroke} />
    </svg>
  );
}
