import { useState, useEffect } from 'react';
import type { TickerSnapshot, TickerNote, PreMarketPrep } from '../types';
import { CandlestickChart } from '../components/charts/CandlestickChart';
import { getTickerName, hasTickerName } from '../data/tickerNames';

const API = import.meta.env.VITE_API_URL || '/api';

export function TickerResearch() {
  const [ticker, setTicker] = useState('QQQ');
  const [tab, setTab] = useState<'history' | 'notes' | 'prep'>('history');
  const [history, setHistory] = useState<TickerSnapshot[]>([]);
  const [notes, setNotes] = useState<TickerNote[]>([]);
  const [prep, setPrep] = useState<PreMarketPrep[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const [hRes, nRes, pRes] = await Promise.all([
        fetch(`${API}/tickers/${encodeURIComponent(ticker)}/history?interval=1d&from=${new Date(Date.now() - 90 * 86400 * 1000).toISOString()}`),
        fetch(`${API}/tickers/${encodeURIComponent(ticker)}/notes?limit=50`),
        fetch(`${API}/tickers/prep?ticker=${encodeURIComponent(ticker)}`),
      ]);
      const h = hRes.ok ? await hRes.json() : { bars: [] };
      const n = nRes.ok ? await nRes.json() : { notes: [] };
      const p = pRes.ok ? await pRes.json() : { items: [] };
      setHistory(h.bars || []);
      setNotes(n.notes || []);
      setPrep(p.items || []);
    } catch {
      setHistory([]);
      setNotes([]);
      setPrep([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, [ticker]);

  const chartData = history.map((b) => ({
    time: new Date(b.time).toISOString().slice(0, 10),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? 0,
  }));

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Recherche Ticker</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Historique, notes analyste et préparation ouverture.
          </div>
        </div>
        <div className="flex gap-2 center">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            placeholder="TICKER"
            style={{
              width: 120,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--rule)',
              background: 'var(--bg-elev-2)',
              color: 'var(--ink)',
              fontFamily: 'var(--mono)',
              fontSize: 14,
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={fetchData}>Chercher</button>
        </div>
      </div>

      <div className="flex gap-2" style={{ marginBottom: 16 }}>
        {(['history', 'notes', 'prep'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
          >
            {t === 'history' ? 'Historique' : t === 'notes' ? 'Notes' : 'Pré-market'}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--ink-3)' }}>Chargement...</div>}

      {tab === 'history' && !loading && (
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">Historique {ticker}{hasTickerName(ticker) ? ` — ${getTickerName(ticker)}` : ''}</div>
            <span className="card-h-meta">{history.length} bars</span>
          </div>
          <div style={{ padding: 16, height: 400 }}>
            {chartData.length > 0 ? (
              <CandlestickChart data={chartData} ticker={ticker} height={368} />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ink-3)' }}>
                Aucune donnée historique
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'notes' && !loading && (
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">Notes {ticker}{hasTickerName(ticker) ? ` — ${getTickerName(ticker)}` : ''}</div>
            <span className="card-h-meta">{notes.length} notes</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {notes.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', padding: '24px 0', textAlign: 'center' }}>Aucune note pour ce ticker.</div>
            ) : (
              notes.map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: '12px 0',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div className="flex between" style={{ marginBottom: 4 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color:
                          n.noteType === 'bull'
                            ? 'var(--accent)'
                            : n.noteType === 'bear'
                            ? 'var(--danger)'
                            : 'var(--ink-3)',
                      }}
                    >
                      {n.noteType.toUpperCase()}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                      {new Date(n.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>{n.content}</div>
                  {n.confidence && (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                      Confiance {n.confidence}%
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'prep' && !loading && (
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">Préparation ouverture {ticker}{hasTickerName(ticker) ? ` — ${getTickerName(ticker)}` : ''}</div>
            <span className="card-h-meta">{prep.length} jours</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {prep.length === 0 ? (
              <div style={{ color: 'var(--ink-3)', padding: '24px 0', textAlign: 'center' }}>Aucune préparation pour ce ticker.</div>
            ) : (
              prep.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '12px 0',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div className="flex between" style={{ marginBottom: 4 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color:
                          p.setupSignal === 'BUY'
                            ? 'var(--accent)'
                            : p.setupSignal === 'SELL'
                            ? 'var(--danger)'
                            : 'var(--ink-3)',
                      }}
                    >
                      {p.setupSignal} · {p.confidence}%
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                      {p.date}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>{p.reasoning}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                    Close veille ${p.closePrev.toFixed(2)}
                    {p.vixPrev != null && ` · VIX ${p.vixPrev.toFixed(1)}`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
