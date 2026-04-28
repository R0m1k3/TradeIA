import type { SignalItem } from '../../types';

const SIGNAL_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  BUY: { bg: '#00D4AA10', border: '#00D4AA', text: '#00D4AA' },
  SELL: { bg: '#FF4D6D10', border: '#FF4D6D', text: '#FF4D6D' },
  HOLD: { bg: '#FFB34710', border: '#FFB347', text: '#FFB347' },
};

interface SignalFeedProps {
  signals: SignalItem[];
  onBlock?: (ticker: string) => void;
}

export function SignalFeed({ signals, onBlock }: SignalFeedProps) {
  if (signals.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-secondary text-sm">
        Waiting for agent cycle...
      </div>
    );
  }

  return (
    <div className="space-y-1.5 overflow-y-auto max-h-72">
      {signals.map((s) => {
        const style = SIGNAL_STYLES[s.signal] || SIGNAL_STYLES.HOLD;
        return (
          <div
            key={s.ticker}
            className="flex items-center gap-3 px-3 py-2 rounded border border-border hover:border-border/80 bg-bg-elevated transition-colors"
          >
            <span className="font-mono font-bold text-xs text-text-primary w-12 flex-shrink-0">
              {s.ticker}
            </span>

            <span
              className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.text }}
            >
              {s.signal}
            </span>

            {/* Debate score bar */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-text-secondary font-mono">
                {s.debate_score > 0 ? '+' : ''}{s.debate_score}
              </span>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 h-3 rounded-sm"
                    style={{
                      background:
                        i < Math.abs(s.debate_score)
                          ? s.debate_score > 0 ? '#00D4AA' : '#FF4D6D'
                          : '#1E2D45',
                    }}
                  />
                ))}
              </div>
            </div>

            <span className="text-[10px] text-text-secondary font-mono flex-1 truncate">
              {s.reasoning}
            </span>

            <span className="text-[10px] text-text-secondary font-mono flex-shrink-0">
              {s.confidence}%
            </span>

            {onBlock && (
              <button
                onClick={() => onBlock(s.ticker)}
                className="text-[10px] font-mono text-accent-red border border-accent-red/30 px-1.5 py-0.5 rounded hover:bg-accent-red/10 transition-colors flex-shrink-0"
              >
                Block
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
