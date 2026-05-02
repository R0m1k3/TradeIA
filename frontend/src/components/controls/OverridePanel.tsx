import { useState } from 'react';
import { useSignalsStore } from '../../store/signals.store';

const API = import.meta.env.VITE_API_URL || '/api';

async function adminPost(path: string): Promise<boolean> {
  const password = prompt('Mot de passe admin :');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {signals.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Aucun signal actif</div>
      )}
      {signals.map((s) => {
        const blocked = blockedTickers.has(s.ticker);
        return (
          <div
            key={s.ticker}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: 'var(--bg-elev-2)', border: '1px solid var(--rule)',
            }}
          >
            <span className="mono" style={{ fontWeight: 600, fontSize: 12, width: 48 }}>{s.ticker}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => handleClose(s.ticker)}
              disabled={loading === `close-${s.ticker}`}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, color: 'var(--warn)' }}
            >
              Fermer
            </button>
            <button
              onClick={() => blocked ? handleUnblock(s.ticker) : handleBlock(s.ticker)}
              disabled={loading === s.ticker}
              className="btn btn-ghost btn-sm"
              style={{
                fontSize: 11,
                color: blocked ? 'var(--accent)' : 'var(--danger)',
              }}
            >
              {blocked ? 'Débloquer' : 'Bloquer'}
            </button>
          </div>
        );
      })}
    </div>
  );
}