import type { SignalItem } from '../../types';
import { getTickerName } from '../../data/tickerNames';

interface HeatMapProps {
  signals: SignalItem[];
}

function getColor(score: number): string {
  if (score >= 3) return '#00D4AA';
  if (score >= 1) return '#00D4AA88';
  if (score === 0) return '#FFB347';
  if (score >= -2) return '#FF4D6D88';
  return '#FF4D6D';
}

function getBg(score: number): string {
  const base = getColor(score);
  return `${base}22`;
}

export function HeatMap({ signals }: HeatMapProps) {
  if (signals.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-secondary text-sm">
        En attente des signaux...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
      {signals.map((s) => (
        <div
          key={s.ticker}
          className="rounded p-2 border flex flex-col items-center gap-1"
          style={{
            background: getBg(s.debate_score),
            borderColor: `${getColor(s.debate_score)}40`,
          }}
        >
          <span className="font-mono font-bold text-xs text-text-primary">{s.ticker}</span>
          <span className="text-[9px] text-text-secondary truncate max-w-[60px]">{getTickerName(s.ticker)}</span>
          <span
            className="text-[10px] font-mono font-medium"
            style={{ color: getColor(s.debate_score) }}
          >
            {s.signal}
          </span>
          <span className="text-[10px] text-text-secondary font-mono">
            {s.debate_score > 0 ? '+' : ''}{s.debate_score}
          </span>
        </div>
      ))}
    </div>
  );
}
