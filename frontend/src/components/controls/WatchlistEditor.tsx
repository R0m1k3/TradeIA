import { useState } from 'react';
import { useConfigStore } from '../../store/config.store';
import { getTickerName } from '../../data/tickerNames';

export function WatchlistEditor() {
  const { config, saveConfig } = useConfigStore();
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const tickers = config.watchlist
    ? config.watchlist.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  async function addTicker() {
    const t = input.trim().toUpperCase();
    if (!t || tickers.includes(t)) { setInput(''); return; }
    const updated = [...tickers, t].join(',');
    setSaving(true);
    await saveConfig({ watchlist: updated });
    setInput('');
    setSaving(false);
  }

  async function removeTicker(ticker: string) {
    const updated = tickers.filter((t) => t !== ticker).join(',');
    await saveConfig({ watchlist: updated });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {tickers.map((t) => (
          <div
            key={t}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 6,
              background: 'var(--bg-elev-2)', border: '1px solid var(--rule)',
            }}
          >
            <span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{t}</span>
            <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{getTickerName(t)}</span>
            <button
              onClick={() => removeTicker(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--ink-4)', fontSize: 14, padding: 0, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && addTicker()}
          placeholder="Ajouter ticker (ex. AAPL)"
          maxLength={8}
          className="input"
          style={{ flex: 1, fontFamily: 'var(--mono)' }}
        />
        <button
          onClick={addTicker}
          disabled={saving || !input.trim()}
          className="btn btn-ghost btn-sm"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}