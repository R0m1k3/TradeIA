import { useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { KpiCard } from '../components/cards/KpiCard';
import { SignalFeed } from '../components/cards/SignalFeed';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import type { Page } from '../App';
import type { OHLCVBar } from '../types';

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'JPM'];

const SIGNAL_COLOR: Record<string, string> = {
  BUY: '#00D4AA',
  SELL: '#FF4D6D',
  HOLD: '#FFB347',
};

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

function FearGreedGauge({ value }: { value: number }) {
  const color = value > 70 ? '#FF4D6D' : value > 55 ? '#FFB347' : value > 45 ? '#8892A4' : value > 30 ? '#4A9EFF' : '#00D4AA';
  const label = value > 70 ? 'Extreme Greed' : value > 55 ? 'Greed' : value > 45 ? 'Neutral' : value > 30 ? 'Fear' : 'Extreme Fear';
  const pct = (value / 100) * 100;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1E2D45" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={color} strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-syne font-bold text-sm" style={{ color }}>{value}</span>
        </div>
      </div>
      <span className="text-[9px] text-text-secondary font-mono text-center">{label}</span>
    </div>
  );
}

export function Dashboard({ onNavigate: _ }: DashboardProps) {
  const { portfolio } = usePortfolioStore();
  const { signals, market } = useSignalsStore();
  const [selectedTicker, setSelectedTicker] = useState('AAPL');

  const selectedSignal = signals.find((s) => s.ticker === selectedTicker);

  // Generate mock OHLCV for chart (replaced by real data when connected)
  const mockBars: OHLCVBar[] = Array.from({ length: 100 }, (_, i) => {
    const base = 180;
    const t = new Date(Date.now() - (99 - i) * 15 * 60 * 1000);
    const open = base + Math.sin(i * 0.3) * 5 + Math.random() * 2;
    const close = open + (Math.random() - 0.48) * 3;
    return {
      time: t.toISOString(),
      open,
      high: Math.max(open, close) + Math.random(),
      low: Math.min(open, close) - Math.random(),
      close,
      volume: 500000 + Math.random() * 300000,
    };
  });

  const pnlPositive = portfolio.daily_pnl_pct >= 0;

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Portfolio Value"
          value={`$${portfolio.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`Cash $${portfolio.cash_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          accentColor="#00D4AA"
        />
        <KpiCard
          label="P&L Today"
          value={`${pnlPositive ? '+' : ''}${portfolio.daily_pnl_pct.toFixed(2)}%`}
          sub={`${pnlPositive ? '+' : ''}$${((portfolio.total_usd * portfolio.daily_pnl_pct) / 100).toFixed(2)}`}
          subPositive={pnlPositive}
          accentColor={pnlPositive ? '#00D4AA' : '#FF4D6D'}
        />
        <KpiCard
          label="Open Positions"
          value={String(portfolio.positions.length)}
          sub={`${signals.filter((s) => s.signal === 'BUY').length} BUY signals`}
          accentColor="#4A9EFF"
        />
        <KpiCard
          label="Risk Regime"
          value={portfolio.risk_regime}
          sub={`VIX ${market.vix.toFixed(1)}`}
          accentColor={portfolio.risk_regime === 'NORMAL' ? '#00D4AA' : portfolio.risk_regime === 'ELEVATED' ? '#FFB347' : '#FF4D6D'}
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Left: Chart (3/5) */}
        <div className="xl:col-span-3 space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
            {/* Ticker pills */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
              {WATCHLIST.map((t) => {
                const sig = signals.find((s) => s.ticker === t);
                const sigColor = sig ? SIGNAL_COLOR[sig.signal] : '#8892A4';
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedTicker(t)}
                    className={`
                      px-2.5 py-1 rounded text-xs font-mono font-bold transition-all duration-150
                      ${selectedTicker === t
                        ? 'bg-accent-green/10 border border-accent-green text-accent-green'
                        : 'border border-border text-text-secondary hover:text-text-primary hover:border-border/60'
                      }
                    `}
                  >
                    {t}
                    {sig && (
                      <span className="ml-1.5 text-[9px]" style={{ color: sigColor }}>
                        ●
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <CandlestickChart data={mockBars} ticker={selectedTicker} height={320} />

            {/* Mini indicators */}
            {selectedSignal && (
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                <div className="px-4 py-2">
                  <p className="text-[10px] text-text-secondary uppercase tracking-wider">RSI 15m</p>
                  <p className={`text-sm font-mono font-bold ${selectedSignal.confidence > 70 ? 'text-accent-amber' : 'text-text-primary'}`}>
                    {selectedSignal.confidence || '—'}
                  </p>
                </div>
                <div className="px-4 py-2">
                  <p className="text-[10px] text-text-secondary uppercase tracking-wider">Signal</p>
                  <p className="text-sm font-mono font-bold" style={{ color: SIGNAL_COLOR[selectedSignal.signal] }}>
                    {selectedSignal.signal}
                  </p>
                </div>
                <div className="px-4 py-2">
                  <p className="text-[10px] text-text-secondary uppercase tracking-wider">Debate</p>
                  <p className={`text-sm font-mono font-bold ${selectedSignal.debate_score > 0 ? 'text-accent-green' : selectedSignal.debate_score < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
                    {selectedSignal.debate_score > 0 ? '+' : ''}{selectedSignal.debate_score}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Signal feed + context (2/5) */}
        <div className="xl:col-span-2 space-y-3">
          {/* Agent Signal Feed */}
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Agent Feed</h3>
            </div>
            <div className="p-3">
              <SignalFeed signals={signals} />
            </div>
          </div>

          {/* Market Context */}
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Market Context</h3>
            </div>
            <div className="p-4 flex items-center justify-around">
              <div className="text-center">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">VIX</p>
                <p className={`font-syne font-bold text-xl ${market.vix > 25 ? 'text-accent-red' : market.vix > 18 ? 'text-accent-amber' : 'text-accent-green'}`}>
                  {market.vix.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2 text-center">Fear & Greed</p>
                <FearGreedGauge value={market.fear_greed} />
              </div>
              <div className="text-center">
                <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">NASDAQ</p>
                <p className={`font-syne font-bold text-sm capitalize ${market.nasdaq === 'bullish' ? 'text-accent-green' : market.nasdaq === 'bearish' ? 'text-accent-red' : 'text-text-secondary'}`}>
                  {market.nasdaq === 'bullish' ? '↑' : market.nasdaq === 'bearish' ? '↓' : '→'} {market.nasdaq}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Watchlist table */}
      <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-syne font-bold text-sm text-text-primary">Watchlist</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {['Ticker', 'Signal', 'Debate Score', 'Bull Conv.', 'Bear Conv.', 'Confidence', 'Reasoning'].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-[10px] text-text-secondary uppercase tracking-wider font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-secondary">
                    Awaiting agent cycle...
                  </td>
                </tr>
              ) : (
                signals.map((s, i) => {
                  const sigColor = SIGNAL_COLOR[s.signal] || '#8892A4';
                  return (
                    <tr
                      key={s.ticker}
                      className="border-b border-border/50 hover:bg-bg-elevated transition-colors"
                      style={{ background: i % 2 === 0 ? undefined : '#111827' }}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-text-primary">{s.ticker}</td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                          style={{ background: `${sigColor}15`, border: `1px solid ${sigColor}50`, color: sigColor }}
                        >
                          {s.signal}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-mono font-bold"
                            style={{ color: s.debate_score > 0 ? '#00D4AA' : s.debate_score < 0 ? '#FF4D6D' : '#FFB347' }}
                          >
                            {s.debate_score > 0 ? '+' : ''}{s.debate_score}
                          </span>
                          <div className="flex gap-0.5">
                            {Array.from({ length: 5 }).map((_, j) => (
                              <div
                                key={j}
                                className="w-1 h-2.5 rounded-sm"
                                style={{ background: j < Math.abs(s.debate_score) ? (s.debate_score > 0 ? '#00D4AA' : '#FF4D6D') : '#1E2D45' }}
                              />
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-accent-green">{s.bull_conviction}/10</td>
                      <td className="px-4 py-3 font-mono text-accent-red">{s.bear_conviction}/10</td>
                      <td className="px-4 py-3 font-mono text-accent-blue">{s.confidence}%</td>
                      <td className="px-4 py-3 text-text-secondary max-w-[200px] truncate">{s.reasoning}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
