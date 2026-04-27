import type { DebateOutput } from '../../types';

interface DebateViewerProps {
  debate: DebateOutput;
}

function ConvictionGauge({ value, color }: { value: number; color: string }) {
  const pct = (value / 10) * 100;
  return (
    <div className="relative w-16 h-16">
      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1E2D45" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-syne font-bold text-sm" style={{ color }}>{value}</span>
      </div>
    </div>
  );
}

export function DebateViewer({ debate }: DebateViewerProps) {
  const scoreColor = debate.debate_score > 0 ? '#00D4AA' : debate.debate_score < 0 ? '#FF4D6D' : '#FFB347';

  return (
    <div className="bg-bg-elevated rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-syne font-bold text-text-primary">{debate.ticker}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">Debate Score</span>
          <span
            className="font-syne font-bold text-xl"
            style={{ color: scoreColor }}
          >
            {debate.debate_score > 0 ? '+' : ''}{debate.debate_score}
          </span>
        </div>
      </div>

      {/* Bull vs Bear */}
      <div className="grid grid-cols-2 divide-x divide-border">
        {/* Bull */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-accent-green uppercase tracking-wider">BULL</span>
            <ConvictionGauge value={debate.bull.conviction} color="#00D4AA" />
          </div>
          <div>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Technical</p>
            <p className="text-xs text-text-primary leading-relaxed">{debate.bull.technical_case}</p>
          </div>
          {debate.bull.fundamental_catalyst && (
            <div>
              <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Catalyst</p>
              <p className="text-xs text-text-primary leading-relaxed">{debate.bull.fundamental_catalyst}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-accent-green uppercase tracking-wider mb-1">Upside target</p>
            <p className="text-sm font-mono font-bold text-accent-green">+{debate.bull.upside_pct?.toFixed(1)}%</p>
          </div>
          {debate.bull.key_risk && (
            <div className="bg-bg-surface rounded p-2">
              <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Key Risk</p>
              <p className="text-[11px] text-accent-amber">{debate.bull.key_risk}</p>
            </div>
          )}
        </div>

        {/* Bear */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold text-accent-red uppercase tracking-wider">BEAR</span>
            <ConvictionGauge value={debate.bear.conviction} color="#FF4D6D" />
          </div>
          <div>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Technical</p>
            <p className="text-xs text-text-primary leading-relaxed">{debate.bear.technical_case}</p>
          </div>
          {debate.bear.structural_weakness && (
            <div>
              <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Weakness</p>
              <p className="text-xs text-text-primary leading-relaxed">{debate.bear.structural_weakness}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-accent-red uppercase tracking-wider mb-1">Downside risk</p>
            <p className="text-sm font-mono font-bold text-accent-red">-{debate.bear.downside_pct?.toFixed(1)}%</p>
          </div>
          {debate.bear.strongest_bull_argument && (
            <div className="bg-bg-surface rounded p-2">
              <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">Strongest Bull Arg</p>
              <p className="text-[11px] text-accent-green">{debate.bear.strongest_bull_argument}</p>
            </div>
          )}
        </div>
      </div>

      {/* Analyst summary */}
      <div className="border-t border-border px-4 py-3 flex items-center gap-6">
        <div>
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">4H Bias</span>
          <p className="text-xs font-mono font-bold" style={{ color: debate.analyst_output.bias_4h === 'BULLISH' ? '#00D4AA' : debate.analyst_output.bias_4h === 'BEARISH' ? '#FF4D6D' : '#FFB347' }}>
            {debate.analyst_output.bias_4h}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">1H Bias</span>
          <p className="text-xs font-mono font-bold" style={{ color: debate.analyst_output.bias_1h === 'BULLISH' ? '#00D4AA' : debate.analyst_output.bias_1h === 'BEARISH' ? '#FF4D6D' : '#FFB347' }}>
            {debate.analyst_output.bias_1h}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">RSI 15m</span>
          <p className="text-xs font-mono font-bold text-text-primary">{debate.analyst_output.rsi_15m?.toFixed(0)}</p>
        </div>
        <div>
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">Confidence</span>
          <p className="text-xs font-mono font-bold text-accent-blue">{debate.analyst_output.confidence}%</p>
        </div>
      </div>
    </div>
  );
}
