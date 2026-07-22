// The Volt "K" monogram — a kinetic K that leans into its stride, the lower leg
// kicking off like a runner leaving the blocks. Uses currentColor so it can be
// inked, volt, or paper depending on the tile behind it.
export function KadenzMark({
  className,
  title = "Kadenz",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={title} fill="currentColor">
      <g transform="skewX(-7)">
        <rect x="26" y="22" width="18" height="76" rx="4" />
        <polygon points="44,58 74,22 94,22 60,62" />
        <polygon points="44,58 62,58 96,98 76,98" />
      </g>
    </svg>
  );
}
