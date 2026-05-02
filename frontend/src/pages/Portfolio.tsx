import { useState, useMemo } from 'react';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import { useSignalsStore } from '../store/signals.store';
import type { OHLCVBar } from '../types';

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'BTC', 'ETH', 'SOL'];

function BigCandles({ candles }: { candles: { o: number; h: number; l: number; c: number }[] }) {
  const w = 1000, h = 360, pad = 28;
  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const r = max - min || 1;
  const cw = (w - pad * 2) / candles.length;
  const ys = (v: number) => pad + (1 - (v - min) / r) * (h - pad * 2);
  const ma20 = candles.map((_, i) => {
    const slice = candles.slice(Math.max(0, i - 19), i + 1);
    return slice.reduce((a, c) => a + c.c, 0) / slice.length;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none">
      {[0.2, 0.4, 0.6, 0.8].map((p) => (
        <line key={p} x1={pad} x2={w - pad} y1={pad + p * (h - pad * 2)} y2={pad + p * (h - pad * 2)} stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const x = pad + i * cw + cw / 2;
        const color = up ? 'var(--accent)' : 'var(--danger)';
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={ys(c.h)} y2={ys(c.l)} stroke={color} strokeWidth="1" />
            <rect x={x - cw * 0.32} y={ys(Math.max(c.o, c.c))} width={cw * 0.64} height={Math.max(1, Math.abs(ys(c.o) - ys(c.c)))} fill={color} />
          </g>
        );
      })}
      <polyline points={ma20.map((v, i) => `${pad + i * cw + cw / 2},${ys(v)}`).join(' ')} fill="none" stroke="var(--info)" strokeWidth="1.5" opacity="0.8" />
      {[min, (min + max) / 2, max].map((v, i) => (
        <text key={i} x={w - pad + 4} y={ys(v) + 3} fill="var(--ink-3)" fontFamily="var(--mono)" fontSize="9">${v.toFixed(2)}</text>
      ))}
    </svg>
  );
}

function VolBars({ candles }: { candles: { v: number; c: number; o: number }[] }) {
  const w = 1000, h = 60, pad = 28;
  const max = Math.max(...candles.map((c) => c.v));
  const cw = (w - pad * 2) / candles.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none">
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const bh = (c.v / max) * (h - 8);
        return <rect key={i} x={pad + i * cw + cw * 0.18} y={h - bh - 4} width={cw * 0.64} height={bh} fill={up ? 'var(--accent)' : 'var(--danger)'} opacity="0.5" />;
      })}
    </svg>
  );
}

export function Portfolio() {
  const [sym, setSym] = useState('AAPL');
  const { signals } = useSignalsStore();

  const candles = useMemo(() => {
    const arr = [];
    let p = 224;
    for (let i = 0; i < 100; i++) {
      const o = p;
      const c = o + (Math.sin(i * 0.3) * 2.5 + (Math.random() - 0.5) * 1.6);
      arr.push({ o, h: Math.max(o, c) + Math.random() * 1.4, l: Math.min(o, c) - Math.random() * 1.4, c, v: 800 + Math.random() * 1200 });
      p = c;
    }
    return arr;
  }, [sym]);

  const last = candles[candles.length - 1].c;
  const prev = candles[candles.length - 2].c;
  const chg = ((last - prev) / prev) * 100;

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Graphiques</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Cours détaillés et analyse technique sur l'actif sélectionné.
          </div>
        </div>
      </div>

      {/* Symbol switcher */}
      <div className="flex gap-2 wrap" style={{ marginBottom: 12 }}>
        {symbols.map((s) => (
          <button
            key={s}
            onClick={() => setSym(s)}
            style={{
              padding: '6px 14px', fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 600,
              border: '1px solid var(--rule)',
              background: sym === s ? 'var(--accent-soft)' : 'var(--bg-elev)',
              color: sym === s ? 'var(--accent)' : 'var(--ink-2)',
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px', gap: 12 }}>
        <div className="card">
          <div className="card-h">
            <div className="flex gap-3 center">
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{sym}</span>
              <span className="mono" style={{ fontSize: 22 }}>${last.toFixed(2)}</span>
              <span className={`badge ${chg >= 0 ? 'badge-up' : 'badge-down'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
            </div>
            <div className="flex gap-2">
              {['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map((tf, i) => (
                <button key={tf} style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'var(--mono)', border: '1px solid var(--rule)', background: i === 5 ? 'var(--accent-soft)' : 'transparent', color: i === 5 ? 'var(--accent)' : 'var(--ink-3)', borderRadius: 4, cursor: 'pointer' }}>{tf}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: 16, height: 380 }}>
            <BigCandles candles={candles} />
          </div>
          <div className="card-h" style={{ borderTop: '1px solid var(--rule)', borderBottom: 'none' }}>
            <span className="eyebrow">Volume</span>
            <span className="card-h-meta">moyenne 20j : 1.2k</span>
          </div>
          <div style={{ padding: '8px 16px 16px', height: 80 }}>
            <VolBars candles={candles} />
          </div>
        </div>

        {/* Side panel */}
        <div className="flex col gap-3">
          <div className="card">
            <div className="card-h"><div className="card-h-title">Contexte de marché</div></div>
            <div style={{ padding: 16 }}>
              {[
                ['Tendance 4h', 'Haussière', 'var(--accent)'],
                ['RSI 14', '58.2', 'var(--ink)'],
                ['MACD', '+0.84', 'var(--accent)'],
                ['Volatilité 20j', '18.4%', 'var(--warn)'],
                ['Support', '$226.50', 'var(--ink)'],
                ['Résistance', '$240.00', 'var(--ink)'],
              ].map(([k, v, c], i) => (
                <div key={k as string} className="flex between" style={{ padding: '10px 0', borderTop: i > 0 ? '1px solid var(--rule)' : 'none', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k as string}</span>
                  <span className="mono" style={{ fontSize: 13, color: c as string, fontWeight: 500 }}>{v as string}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-h-title">Analyse en cours</div></div>
            <div style={{ padding: 16, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Modérateur</div>
              <p style={{ marginBottom: 12 }}>Setup haussier confirmé sur 4h. RSI neutre, MACD positif, volume au-dessus de la moyenne 20j.</p>
              <p>Position recommandée : <strong style={{ color: 'var(--accent)' }}>LONG 2.4%</strong> du book. Stop suggéré <span className="mono">$226.50</span>. Cible <span className="mono">$240.00</span>.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
