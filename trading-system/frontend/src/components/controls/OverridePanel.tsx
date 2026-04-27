import { useState } from 'react';
import { useSignalsStore } from '../../store/signals.store';

const API = import.meta.env.VITE_API_URL || '/api';

async function adminPost(path: string): Promise<boolean> {
  const password = prompt('Admin password:');
  if (!password) return false;
  try {
    const res = await fetch(`${API}/override/${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`:${password}`)}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function OverridePanel() {
  const { signals } = useSignalsStore();
  const [blockedTickers, setBlockedTickers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  async function handleBlock(ticker: string) {
    setLoading(ticker);
    const ok = await adminPost(`block/${ticker}`);
    if (ok) setBlockedTickers((prev) => new Set([...prev, ticker]));
    setLoading(null);
  }

  async function handleUnblock(ticker: string) {
    setLoading(ticker);
    const ok = await adminPost(`unblock/${ticker}`);
    if (ok) setBlockedTickers((prev) => { const s = new Set(prev); s.delete(ticker); return s; });
    setLoading(null);
  }

  async function handleClose(ticker: string) {
    setLoading(`close-${ticker}`);
    await adminPost(`close/${ticker}`);
    setLoading(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-secondary uppercase tracking-wider">Manual Overrides</p>
      {signals.length === 0 && (
        <p className="text-sm text-text-secondary">No active signals</p>
      )}
      {signals.map((s) => {
        const blocked = blockedTickers.has(s.ticker);
        return (
          <div
            key={s.ticker}
            className="flex items-center gap-3 px-3 py-2 bg-bg-elevated rounded border border-border"
          >
            <span className="font-mono font-bold text-xs text-text-primary w-12">{s.ticker}</span>
            <div className="flex-1" />
            <button
              onClick={() => handleClose(s.ticker)}
              disabled={loading === `close-${s.ticker}`}
              className="text-[10px] font-mono px-2 py-1 rounded border border-accent-amber/40 text-accent-amber hover:bg-accent-amber/10 transition-colors disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={() => blocked ? handleUnblock(s.ticker) : handleBlock(s.ticker)}
              disabled={loading === s.ticker}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-50
                ${blocked
                  ? 'border-accent-green/40 text-accent-green hover:bg-accent-green/10'
                  : 'border-accent-red/40 text-accent-red hover:bg-accent-red/10'
                }`}
            >
              {blocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
