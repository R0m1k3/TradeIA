import { useState, useEffect, useCallback } from 'react';

type Segment = 'nasdaq' | 'cac40' | 'dax40' | 'ftse100' | 'eu_other';

interface TickerSnapshot {
  ticker: string;
  price: number | null;
  change_1d_pct: number | null;
  volume: number | null;
}

type SortKey = 'ticker' | 'price' | 'change_1d_pct' | 'volume';

const TABS: Array<{ id: Segment; label: string }> = [
  { id: 'nasdaq', label: 'NASDAQ 100' },
  { id: 'cac40', label: 'CAC 40' },
  { id: 'dax40', label: 'DAX 40' },
  { id: 'ftse100', label: 'FTSE 100' },
  { id: 'eu_other', label: 'EU Autres' },
];

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function formatVolume(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

function formatPrice(p: number | null): string {
  if (p === null) return '—';
  return p.toFixed(2);
}

function displaySymbol(ticker: string): string {
  if (!ticker.includes(':')) return ticker;
  return ticker.split(':')[0];
}

function Tendance({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  if (pct > 0.5) return <span style={{ color: 'var(--accent)' }}>↑</span>;
  if (pct < -0.5) return <span style={{ color: 'var(--danger)' }}>↓</span>;
  return <span style={{ color: 'var(--ink-3)' }}>→</span>;
}

export function Watchlist() {
  const [activeTab, setActiveTab] = useState<Segment>('nasdaq');
  const [data, setData] = useState<Partial<Record<Segment, TickerSnapshot[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<Segment, boolean>>>({});
  const [sortKey, setSortKey] = useState<SortKey>('change_1d_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const fetchSegment = useCallback(async (segment: Segment) => {
    setLoading((prev) => ({ ...prev, [segment]: true }));
    try {
      const res = await fetch(`/api/market/snapshot/${segment}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TickerSnapshot[] = await res.json();
      setData((prev) => ({ ...prev, [segment]: json }));
    } catch (err) {
      console.warn(`[Watchlist] Failed to fetch ${segment}:`, err);
    } finally {
      setLoading((prev) => ({ ...prev, [segment]: false }));
    }
  }, []);

  // Fetch active tab on mount and on tab change
  useEffect(() => {
    fetchSegment(activeTab);
  }, [activeTab, fetchSegment, lastRefresh]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefresh(Date.now());
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const rows = data[activeTab] ?? [];
  const sorted = [...rows].sort((a, b) => {
    let aVal: number | string | null;
    let bVal: number | string | null;
    if (sortKey === 'ticker') {
      aVal = displaySymbol(a.ticker);
      bVal = displaySymbol(b.ticker);
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

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20, fontWeight: 600 }}>Watchlist Marchés</h2>

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
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Actualisation auto 5 min
          </span>
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

      {/* Table */}
      {isLoading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-4)' }}>
          Chargement...
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-4)', fontSize: 11 }}>
              <th
                style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => handleSort('ticker')}
              >
                Symbole{sortArrow('ticker')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => handleSort('price')}
              >
                Prix{sortArrow('price')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => handleSort('change_1d_pct')}
              >
                Var 1j %{sortArrow('change_1d_pct')}
              </th>
              <th
                style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => handleSort('volume')}
              >
                Volume{sortArrow('volume')}
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 500 }}>
                Tendance
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-4)' }}>
                  Aucune donnée disponible
                </td>
              </tr>
            ) : sorted.map((row, idx) => {
              const pct = row.change_1d_pct;
              const pctColor = pct === null ? 'var(--ink-4)' : pct >= 0 ? 'var(--accent)' : 'var(--danger)';
              return (
                <tr
                  key={row.ticker}
                  style={{
                    borderBottom: '1px solid var(--rule)',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                    {displaySymbol(row.ticker)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--mono)' }}>
                    {formatPrice(row.price)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: pctColor, fontFamily: 'var(--mono)', fontWeight: 500 }}>
                    {pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                    {formatVolume(row.volume)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 16 }}>
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
