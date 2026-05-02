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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tickers.map((t) => (
          <div
            key={t}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-bg-elevated border border-border"
          >
            <span className="text-xs font-mono font-bold text-text-primary">{t}</span>
            <span className="text-[9px] text-text-secondary">{getTickerName(t)}</span>
            <button
              onClick={() => removeTicker(t)}
              className="text-text-secondary hover:text-accent-red transition-colors text-xs"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && addTicker()}
          placeholder="Ajouter ticker (ex. AAPL)"
          maxLength={8}
          className="flex-1 bg-bg-elevated border border-border rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent-blue"
        />
        <button
          onClick={addTicker}
          disabled={saving || !input.trim()}
          className="px-3 py-1.5 bg-accent-blue/10 border border-accent-blue/30 text-accent-blue text-xs font-mono rounded hover:bg-accent-blue/20 transition-colors disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}
