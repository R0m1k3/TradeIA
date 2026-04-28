import { useState } from 'react';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import { HeatMap } from '../components/charts/HeatMap';
import { useSignalsStore } from '../store/signals.store';
import type { OHLCVBar } from '../types';

const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'META', 'JPM', 'BAC', 'GE'];
const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;
type Timeframe = typeof TIMEFRAMES[number];

function generateMockBars(ticker: string, tf: Timeframe): OHLCVBar[] {
  const seed = ticker.charCodeAt(0);
  const base = 100 + seed;
  const intervalMs: Record<Timeframe, number> = { '15m': 15 * 60 * 1000, '1h': 3600 * 1000, '4h': 4 * 3600 * 1000, '1d': 86400 * 1000 };
  const count = 100;
  const bars: OHLCVBar[] = [];
  let price = base;
  for (let i = count; i >= 0; i--) {
    const t = new Date(Date.now() - i * intervalMs[tf]);
    const open = price;
    const change = (Math.random() - 0.49) * (base * 0.015);
    const close = Math.max(1, open + change);
    price = close;
    bars.push({
      time: t.toISOString(),
      open,
      high: Math.max(open, close) * (1 + Math.random() * 0.003),
      low: Math.min(open, close) * (1 - Math.random() * 0.003),
      close,
      volume: 300000 + Math.random() * 700000,
    });
  }
  return bars;
}

function RSIPanel({ rsi }: { rsi: number }) {
  const color = rsi > 70 ? '#FF4D6D' : rsi < 30 ? '#00D4AA' : '#8892A4';
  return (
    <div className="relative h-16">
      <div className="absolute inset-0 flex items-end">
        <div className="w-full h-full flex flex-col justify-between">
          <div className="w-full h-px bg-accent-red/30" style={{ marginTop: '20%' }} />
          <div className="w-full h-px bg-accent-green/30" style={{ marginBottom: '20%' }} />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center flex-col gap-1">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider">RSI</span>
        <span className="font-syne font-bold text-xl" style={{ color }}>{rsi.toFixed(0)}</span>
        <span className="text-[10px] font-mono" style={{ color }}>
          {rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'}
        </span>
      </div>
    </div>
  );
}

export function Markets() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const { signals, market } = useSignalsStore();

  const bars = generateMockBars(selectedTicker, timeframe);
  const signal = signals.find((s) => s.ticker === selectedTicker);
  const mockRSI = 45 + Math.sin(selectedTicker.charCodeAt(0)) * 25;

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Timeframe selector + ticker */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
                timeframe === tf
                  ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                  : 'border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex gap-1 flex-wrap">
          {TICKERS.map((t) => {
            const s = signals.find((sig) => sig.ticker === t);
            return (
              <button
                key={t}
                onClick={() => setSelectedTicker(t)}
                className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                  selectedTicker === t
                    ? 'border-accent-green bg-accent-green/10 text-accent-green'
                    : 'border-border text-text-secondary hover:text-text-primary'
                }`}
              >
                {t}
                {s && <span className="ml-1 opacity-60">●</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Main chart area (3/4) */}
        <div className="xl:col-span-3 space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
            <CandlestickChart data={bars} ticker={selectedTicker} height={400} />
            {/* RSI & indicators */}
            <div className="border-t border-border grid grid-cols-3 divide-x divide-border">
              <div className="p-3">
                <RSIPanel rsi={mockRSI} />
              </div>
              <div className="p-3 flex flex-col justify-center items-center gap-1">
                <span className="text-[10px] text-text-secondary uppercase tracking-wider">MACD</span>
                <div className="flex gap-1 items-end h-8">
                  {Array.from({ length: 12 }).map((_, i) => {
                    const val = Math.sin(i * 0.8) * 20;
                    return (
                      <div
                        key={i}
                        className="w-2 rounded-sm"
                        style={{
                          height: `${Math.abs(val)}px`,
                          background: val >= 0 ? '#00D4AA' : '#FF4D6D',
                          opacity: 0.7 + i * 0.025,
                        }}
                      />
                    );
                  })}
                </div>
                <span className="text-[10px] font-mono" style={{ color: '#00D4AA' }}>Bullish cross</span>
              </div>
              <div className="p-3 flex flex-col justify-center items-center gap-1">
                <span className="text-[10px] text-text-secondary uppercase tracking-wider">Volume</span>
                <div className="flex gap-0.5 items-end h-8">
                  {Array.from({ length: 16 }).map((_, i) => {
                    const h = 8 + Math.random() * 24;
                    return (
                      <div
                        key={i}
                        className="w-1.5 rounded-sm"
                        style={{ height: `${h}px`, background: i === 15 ? '#4A9EFF' : '#1E2D45' }}
                      />
                    );
                  })}
                </div>
                <span className="text-[10px] font-mono text-accent-blue">1.2× avg</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel: News + signal (1/4) */}
        <div className="space-y-3">
          {signal && (
            <div className="bg-bg-surface rounded-lg border border-border p-4 space-y-3">
              <h3 className="font-syne font-bold text-sm text-text-primary">{selectedTicker} Signal</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Signal</span>
                  <span
                    className="font-mono font-bold"
                    style={{ color: signal.signal === 'BUY' ? '#00D4AA' : signal.signal === 'SELL' ? '#FF4D6D' : '#FFB347' }}
                  >
                    {signal.signal}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Confidence</span>
                  <span className="font-mono text-accent-blue">{signal.confidence}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Debate</span>
                  <span
                    className="font-mono font-bold"
                    style={{ color: signal.debate_score > 0 ? '#00D4AA' : '#FF4D6D' }}
                  >
                    {signal.debate_score > 0 ? '+' : ''}{signal.debate_score}
                  </span>
                </div>
                <div className="text-xs">
                  <p className="text-text-secondary mb-1">Sentiment</p>
                  <div className="w-full bg-bg-elevated rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${50 + signal.debate_score * 10}%`,
                        background: signal.debate_score > 0 ? '#00D4AA' : '#FF4D6D',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-syne font-bold text-sm text-text-primary">Market Context</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-secondary">VIX</span>
                <span
                  className="text-sm font-mono font-bold"
                  style={{ color: market.vix > 25 ? '#FF4D6D' : market.vix > 18 ? '#FFB347' : '#00D4AA' }}
                >
                  {market.vix.toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-secondary">Fear & Greed</span>
                <span className="text-sm font-mono text-text-primary">{market.fear_greed}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-secondary">NASDAQ</span>
                <span
                  className="text-sm font-mono font-bold capitalize"
                  style={{ color: market.nasdaq === 'bullish' ? '#00D4AA' : market.nasdaq === 'bearish' ? '#FF4D6D' : '#8892A4' }}
                >
                  {market.nasdaq}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-bg-surface rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-syne font-bold text-sm text-text-primary">Watchlist Heatmap</h3>
        </div>
        <div className="p-4">
          <HeatMap signals={signals} />
        </div>
      </div>
    </div>
  );
}
