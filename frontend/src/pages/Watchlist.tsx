import { useState, useEffect, useCallback } from 'react';

type Segment = 'nasdaq' | 'cac40' | 'dax40' | 'ftse100' | 'eu_other';

interface TickerSnapshot {
  ticker: string;
  name: string | null;
  price: number | null;
  change_1d_pct: number | null;
  volume: number | null;
}

type SortKey = 'ticker' | 'name' | 'price' | 'change_1d_pct' | 'volume';

const TABS: Array<{ id: Segment; label: string }> = [
  { id: 'nasdaq', label: 'NASDAQ 100' },
  { id: 'cac40', label: 'CAC 40' },
  { id: 'dax40', label: 'DAX 40' },
  { id: 'ftse100', label: 'FTSE 100' },
  { id: 'eu_other', label: 'EU Autres' },
];

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatVolume(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}G`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

function formatPrice(p: number | null): string {
  if (p === null) return '—';
  if (p >= 1000) return p.toFixed(0);
  if (p >= 10) return p.toFixed(2);
  return p.toFixed(4);
}

function displaySymbol(ticker: string): string {
  if (!ticker.includes(':')) return ticker;
  return ticker.split(':')[0];
}

function Tendance({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  if (pct > 0.5) return <span style={{ color: 'var(--accent)', fontSize: 18 }}>↑</span>;
  if (pct < -0.5) return <span style={{ color: 'var(--danger)', fontSize: 18 }}>↓</span>;
  return <span style={{ color: 'var(--ink-3)', fontSize: 18 }}>→</span>;
}

export function Watchlist() {
  const [activeTab, setActiveTab] = useState<Segment>('nasdaq');
  const [data, setData] = useState<Partial<Record<Segment, TickerSnapshot[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<Segment, boolean>>>({});
  const [error, setError] = useState<Partial<Record<Segment, string>>>({});
  const [sortKey, setSortKey] = useState<SortKey>('change_1d_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const fetchSegment = useCallback(async (segment: Segment) => {
    setLoading((prev) => ({ ...prev, [segment]: true }));
    setError((prev) => ({ ...prev, [segment]: undefined }));
    try {
      const res = await fetch(`/api/market/snapshot/${segment}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) {
        throw new Error(json?.error ?? 'Réponse inattendue du serveur');
      }
      setData((prev) => ({ ...prev, [segment]: json as TickerSnapshot[] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      console.warn(`[Watchlist] Failed to fetch ${segment}:`, msg);
      setError((prev) => ({ ...prev, [segment]: msg }));
    } finally {
      setLoading((prev) => ({ ...prev, [segment]: false }));
    }
  }, []);

  useEffect(() => {
    fetchSegment(activeTab);
  }, [activeTab, fetchSegment, lastRefresh]);

  useEffect(() => {
    const interval = setInterval(() => setLastRefresh(Date.now()), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ticker' || key === 'name' ? 'asc' : 'desc');
    }
  };

  const rows = data[activeTab] ?? [];
  const sorted = [...rows].sort((a, b) => {
    let aVal: number | string | null;
    let bVal: number | string | null;
    if (sortKey === 'ticker') {
      aVal = displaySymbol(a.ticker);
      bVal = displaySymbol(b.ticker);
    } else if (sortKey === 'name') {
      aVal = a.name ?? displaySymbol(a.ticker);
      bVal = b.name ?? displaySymbol(b.ticker);
    } else {
      aVal = a[sortKey];
      bVal = b[sortKey];
    }

    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const isLoading = !!loading[activeTab];
  const errMsg = error[activeTab];

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const withPrices = rows.filter((r) => r.price !== null).length;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Watchlist Marchés</h2>
        {!isLoading && rows.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {withPrices}/{rows.length} cours disponibles
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--rule)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--ink-3)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Actualisation auto 5 min</span>
          <button
            onClick={() => setLastRefresh(Date.now())}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              background: 'var(--bg-elev)',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              color: 'var(--ink-2)',
              cursor: 'pointer',
            }}
          >
            Actualiser
          </button>
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-4)' }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
          <div>Chargement des cours en cours…</div>
          <div style={{ fontSize: 11, marginTop: 8, color: 'var(--ink-5)' }}>
            Première charge : peut prendre 10–30 secondes selon le nombre d'actions
          </div>
        </div>
      )}

      {!isLoading && errMsg && (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--danger)' }}>
          Erreur : {errMsg}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => fetchSegment(activeTab)}
              style={{
                padding: '6px 14px', fontSize: 12, background: 'var(--bg-elev)',
                border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer', color: 'var(--ink-2)',
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      )}

      {!isLoading && !errMsg && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-4)', fontSize: 11 }}>
              <th
                style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontWeight: 500, width: 80 }}
                onClick={() => handleSort('ticker')}
              >
                Code{sortArrow('ticker')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => handleSort('name')}
              >
                Société{sortArrow('name')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500, width: 100 }}
                onClick={() => handleSort('price')}
              >
                Prix{sortArrow('price')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500, width: 100 }}
                onClick={() => handleSort('change_1d_pct')}
              >
                Var 1j %{sortArrow('change_1d_pct')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500, width: 90 }}
                onClick={() => handleSort('volume')}
              >
                Volume{sortArrow('volume')}
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 500, width: 70 }}>
                Tendance
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-4)' }}>
                  Aucune donnée disponible — cliquez sur Actualiser
                </td>
              </tr>
            ) : sorted.map((row, idx) => {
              const pct = row.change_1d_pct;
              const pctColor = pct === null ? 'var(--ink-4)' : pct >= 0 ? 'var(--accent)' : 'var(--danger)';
              const sym = displaySymbol(row.ticker);
              return (
                <tr
                  key={row.ticker}
                  style={{
                    borderBottom: '1px solid var(--rule)',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12 }}>
                    {sym}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>
                    {row.name ?? <span style={{ color: 'var(--ink-5)', fontStyle: 'italic' }}>{sym}</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                    {row.price === null
                      ? <span style={{ color: 'var(--ink-5)' }}>—</span>
                      : formatPrice(row.price)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: pctColor, fontFamily: 'var(--mono)', fontWeight: 500 }}>
                    {pct === null ? <span style={{ color: 'var(--ink-5)' }}>—</span> : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                    {formatVolume(row.volume)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <Tendance pct={pct} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
