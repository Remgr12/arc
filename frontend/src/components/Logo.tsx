const RING_OUTER = "url(#arc-ring-outer)";
const RING_INNER = "url(#arc-ring-inner)";

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <defs>
        <linearGradient id="arc-ring-outer" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#58a9ff" />
          <stop offset="1" stopColor="#9e6bfa" />
        </linearGradient>
        <linearGradient id="arc-ring-inner" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9e6bfa" />
          <stop offset="1" stopColor="#58a9ff" />
        </linearGradient>
      </defs>
      <path
        d="M256 96 A160 160 0 1 0 416 256"
        fill="none"
        stroke={RING_OUTER}
        strokeWidth="48"
        strokeLinecap="round"
      />
      <path
        d="M184 256 A72 72 0 1 1 256 328"
        fill="none"
        stroke={RING_INNER}
        strokeWidth="48"
        strokeLinecap="round"
      />
    </svg>
  );
}
