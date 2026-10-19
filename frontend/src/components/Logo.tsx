export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <path
        d="M256 96 A160 160 0 1 0 416 256"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="48"
        strokeLinecap="round"
      />
      <path
        d="M184 256 A72 72 0 1 1 256 328"
        fill="none"
        stroke="currentColor"
        strokeWidth="48"
        strokeLinecap="round"
      />
    </svg>
  );
}
