import { useEffect, useState } from 'react';
import type { DecisionItem, DecisionsLatestResponse } from '../../types/decision';

interface Props {
  apiBase: string;
  refreshKey?: unknown;
}

const ACTION_META: Record<string, { color: string; label: string; bg: string }> = {
  BUY: { color: 'var(--accent)', label: 'ACHAT', bg: 'var(--accent-soft, rgba(34,197,94,0.15))' },
  SELL: { color: 'var(--danger)', label: 'VENTE', bg: 'var(--danger-soft, rgba(239,68,68,0.15))' },
  HOLD: { color: 'var(--ink-3)', label: 'ATTENDRE', bg: 'var(--bg-elev-2)' },
};

function actionWeight(a: string): number {
  if (a === 'BUY') return 0;
  if (a === 'SELL') return 1;
  return 2;
}

export function DecisionViewer({ apiBase, refreshKey }: Props) {
  const [data, setData] = useState<DecisionsLatestResponse | null>(null);
  const [selected, setSelected] = useState<DecisionItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBase}/decisions/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, refreshKey]);

  const decisions = data?.decisions ?? [];

  // Tri: BUY d'abord, puis SELL, puis HOLD; à action égale → confidence décroissante
  const sorted = [...decisions].sort((a, b) => {
    const w = actionWeight(a.action) - actionWeight(b.action);
    if (w !== 0) return w;
    return b.confidence - a.confidence;
  });

  // Stats
  const counts = {
    BUY: decisions.filter((d) => d.action === 'BUY').length,
    SELL: decisions.filter((d) => d.action === 'SELL').length,
    HOLD: decisions.filter((d) => d.action === 'HOLD').length,
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
        Chargement des décisions...
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
        Aucune décision pour le moment — le LLM produira ses choix au prochain cycle.
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-h">
          <div className="card-h-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
            Décisions LLM
          </div>
          <span className="card-h-meta">
            {data?.cycleAt ? `Cycle: ${new Date(data.cycleAt).toLocaleString('fr-FR')}` : ''}
          </span>
        </div>

        <div style={{ padding: 16 }}>
          {/* Résumé compteurs */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, padding: 12, background: ACTION_META.BUY.bg, borderRadius: 8, borderLeft: `3px solid ${ACTION_META.BUY.color}` }}>
              <div className="eyebrow">Achats</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: ACTION_META.BUY.color }}>{counts.BUY}</div>
            </div>
            <div style={{ flex: 1, padding: 12, background: ACTION_META.SELL.bg, borderRadius: 8, borderLeft: `3px solid ${ACTION_META.SELL.color}` }}>
              <div className="eyebrow">Ventes</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: ACTION_META.SELL.color }}>{counts.SELL}</div>
            </div>
            <div style={{ flex: 1, padding: 12, background: ACTION_META.HOLD.bg, borderRadius: 8, borderLeft: `3px solid ${ACTION_META.HOLD.color}` }}>
              <div className="eyebrow">Attentes</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: ACTION_META.HOLD.color }}>{counts.HOLD}</div>
            </div>
          </div>

          {/* Liste décisions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map((d) => {
              const m = ACTION_META[d.action] ?? ACTION_META.HOLD;
              const isHeld = d.inputs_seen?.is_held;
              const rr = d.limit_price > 0 && d.stop_loss > 0 && d.limit_price !== d.stop_loss
                ? ((d.take_profit - d.limit_price) / Math.abs(d.limit_price - d.stop_loss))
                : null;

              return (
                <button
                  key={`${d.ticker}-${d.timestamp}`}
                  onClick={() => setSelected(d)}
                  style={{
                    textAlign: 'left',
                    background: 'var(--bg-elev-2)',
                    border: `1px solid var(--rule)`,
                    borderLeft: `3px solid ${m.color}`,
                    borderRadius: 8,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    color: 'inherit',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{d.ticker}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                        background: m.color + '22', color: m.color,
                      }}>{m.label}</span>
                      {isHeld && (
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, color: 'var(--ink-3)', background: 'var(--bg-elev)' }}>
                          tenu
                        </span>
                      )}
                      {d.inputs_seen?.segment && (
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, color: 'var(--ink-4)', background: 'var(--bg-elev)' }}>
                          {d.inputs_seen.segment}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11 }} className="mono">
                      <span style={{ color: 'var(--accent)' }}>conf {d.confidence}%</span>
                      {d.action === 'BUY' && (
                        <>
                          <span style={{ color: 'var(--ink-3)' }}>size {d.size_pct}%</span>
                          {rr !== null && <span style={{ color: 'var(--info)' }}>R/R {rr.toFixed(1)}</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                    {d.reasoning}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drawer détail */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid',
            justifyItems: 'end', zIndex: 80,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(600px, 100vw)', height: '100%', background: 'var(--bg-elev)',
              borderLeft: '1px solid var(--rule)', padding: 20, overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div className="eyebrow">Décision LLM</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)' }}>{selected.ticker}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Fermer</button>
            </div>

            {/* Action principale */}
            {(() => {
              const m = ACTION_META[selected.action];
              return (
                <div style={{ padding: 16, background: m.bg, borderRadius: 8, marginBottom: 16, borderLeft: `4px solid ${m.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: m.color, fontFamily: 'var(--mono)', letterSpacing: 1 }}>
                      {m.label}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--mono)', fontSize: 13 }}>
                      <span><span style={{ color: 'var(--ink-3)' }}>conf </span><b>{selected.confidence}%</b></span>
                      {selected.action === 'BUY' && <span><span style={{ color: 'var(--ink-3)' }}>taille </span><b>{selected.size_pct}%</b></span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-1, var(--ink))', lineHeight: 1.55 }}>
                    {selected.reasoning}
                  </div>
                </div>
              );
            })()}

            {/* Niveaux si BUY */}
            {selected.action === 'BUY' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
                  <div className="eyebrow">Entry</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>${selected.limit_price.toFixed(2)}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
                  <div className="eyebrow">Stop</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>${selected.stop_loss.toFixed(2)}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
                  <div className="eyebrow">Target</div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>${selected.take_profit.toFixed(2)}</div>
                </div>
              </div>
            )}

            {/* Bull / Bear */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
                <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 4 }}>Plaide POUR</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{selected.bull_case || '—'}</div>
              </div>
              <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 8, borderLeft: '3px solid var(--danger)' }}>
                <div className="eyebrow" style={{ color: 'var(--danger)', marginBottom: 4 }}>Plaide CONTRE</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{selected.bear_case || '—'}</div>
              </div>
            </div>

            {/* Risque + invalidation */}
            <div style={{ marginBottom: 16 }}>
              {selected.key_risk && (
                <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6, marginBottom: 8 }}>
                  <div className="eyebrow" style={{ color: 'var(--warn)', marginBottom: 3 }}>Risque clé</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{selected.key_risk}</div>
                </div>
              )}
              {selected.invalidation && (
                <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6 }}>
                  <div className="eyebrow" style={{ marginBottom: 3 }}>Invalidation</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{selected.invalidation}</div>
                </div>
              )}
            </div>

            {/* Inputs vus */}
            <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 8 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Infos que le LLM a vues</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }} className="mono">
                <div style={{ color: 'var(--ink-3)' }}>News count</div>
                <div>{selected.inputs_seen?.news_count ?? 0}</div>
                <div style={{ color: 'var(--ink-3)' }}>News positives</div>
                <div style={{ color: 'var(--accent)' }}>{selected.inputs_seen?.news_positive ?? 0}</div>
                <div style={{ color: 'var(--ink-3)' }}>News négatives</div>
                <div style={{ color: 'var(--danger)' }}>{selected.inputs_seen?.news_negative ?? 0}</div>
                <div style={{ color: 'var(--ink-3)' }}>Calibration historique</div>
                <div>
                  {selected.inputs_seen?.has_calibration
                    ? `WR ${((selected.inputs_seen.calibration_wr ?? 0) * 100).toFixed(0)}%`
                    : 'pas assez de données'}
                </div>
                <div style={{ color: 'var(--ink-3)' }}>Position tenue</div>
                <div>{selected.inputs_seen?.is_held ? 'oui' : 'non'}</div>
                {selected.trade_type && (
                  <>
                    <div style={{ color: 'var(--ink-3)' }}>Type de trade</div>
                    <div>{selected.trade_type}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
