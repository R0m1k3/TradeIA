interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  subPositive?: boolean;
  accentColor?: string;
  loading?: boolean;
}

export function KpiCard({ label, value, sub, subPositive, accentColor = '#4A9EFF', loading }: KpiCardProps) {
  return (
    <div
      className="bg-bg-surface rounded-lg p-4 flex flex-col gap-2 border border-border relative overflow-hidden"
      style={{ borderTop: `2px solid ${accentColor}` }}
    >
      {loading ? (
        <div className="space-y-2">
          <div className="h-3 bg-bg-elevated rounded animate-pulse w-16" />
          <div className="h-7 bg-bg-elevated rounded animate-pulse w-28" />
        </div>
      ) : (
        <>
          <span className="text-[11px] text-text-secondary uppercase tracking-wider font-mono">{label}</span>
          <span className="font-syne font-bold text-2xl text-text-primary leading-none">{value}</span>
          {sub && (
            <span
              className="text-sm font-mono-data font-medium"
              style={{ color: subPositive === undefined ? '#8892A4' : subPositive ? '#00D4AA' : '#FF4D6D' }}
            >
              {sub}
            </span>
          )}
        </>
      )}
    </div>
  );
}
