type Props = { pct: number; height?: number; track?: string; fill?: string; className?: string };

export function ProgressBar({ pct, height = 6, track = "#E2EAE7", fill = "#12A386", className = "" }: Props) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full overflow-hidden ${className}`} style={{ height, background: track, borderRadius: height / 2 }} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${p}%`, height: "100%", background: fill, borderRadius: height / 2 }} />
    </div>
  );
}
