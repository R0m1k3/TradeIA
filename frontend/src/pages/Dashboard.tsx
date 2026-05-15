import { useState, useMemo, useEffect, useRef } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import { HeatMap } from '../components/charts/HeatMap';
import type { Page } from '../App';
import type { SectorBias } from '../types';
import type { DecisionItem, DecisionsLatestResponse } from '../types/decision';

const SIGNAL_COLOR: Record<string, string> = {
  BUY: 'var(--accent)',
  SELL: 'var(--danger)',
  HOLD: 'var(--warn)',
};
const SIGNAL_LABEL: Record<string, string> = {
  BUY: 'ACHAT',
  SELL: 'VENTE',
  HOLD: 'CONSERVE',
};

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

// Neophyte-friendly market labels
function vixLabel(vix: number): { text: string; color: string } {
  if (vix <= 15) return { text: 'Marché calme', color: 'var(--accent)' };
  if (vix <= 20) return { text: 'Marché normal', color: 'var(--ink-3)' };
  if (vix <= 30) return { text: 'Marché nerveux', color: 'var(--warn)' };
  return { text: 'Marché paniqué', color: 'var(--danger)' };
}

function fearGreedLabel(fg: number): { text: string; color: string } {
  if (fg <= 25) return { text: 'Peur extrême', color: 'var(--danger)' };
  if (fg <= 45) return { text: 'Peur', color: 'var(--warn)' };
  if (fg <= 55) return { text: 'Neutre', color: 'var(--ink-3)' };
  if (fg <= 75) return { text: 'Confiace', color: 'var(--accent)' };
  return { text: 'Cupidité', color: 'var(--accent)' };
}

function macroRegimeLabel(regime: string): { text: string; color: string } {
  if (regime === 'EXPANSIF') return { text: 'Politique monétaire accommodante — la Fed stimule l\'économie', color: 'var(--accent)' };
  if (regime === 'RESTRICTIF') return { text: 'Politique restrictive — la Fed resserre les taux', color: 'var(--danger)' };
  return { text: 'Politique monétaire neutre', color: 'var(--info)' };
}

function freshnessLabel(status?: string): { label: string; text: string; color: string } {
  if (status === 'live') return { label: 'Live', text: 'Données très fraîches', color: 'var(--accent)' };
  if (status === 'fresh') return { label: 'Fraîches', text: 'Données récentes', color: 'var(--accent)' };
  if (status === 'delayed') return { label: 'Différées', text: 'Actions gratuites probablement retardées', color: 'var(--warn)' };
  if (status === 'limited') return { label: 'Limitées', text: 'Sources gratuites/API FREE, confiance réduite', color: 'var(--warn)' };
  if (status === 'stale') return { label: 'Anciennes', text: 'Données à confirmer avant décision', color: 'var(--danger)' };
  return { label: 'Incomplètes', text: 'Certaines sources manquent', color: 'var(--danger)' };
}

/**
 * Pipeline 5 étapes — une seule appelle le LLM.
 * Les clés mappent les états `agents` du store (mis à jour par l'orchestrator).
 */
const PIPELINE: Array<{ id: string; name: string; isLLM: boolean }> = [
  { id: 'collector', name: 'Collecteur', isLLM: false },
  { id: 'analyst', name: 'Analyste', isLLM: false },
  { id: 'strategist', name: 'Décideur', isLLM: true },
  { id: 'risk', name: 'Risk', isLLM: false },
  { id: 'reporter', name: 'Broker', isLLM: false },
];

const STATS_REFRESH_MS = 5 * 60 * 1000;

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { portfolio, history, typeStats, fetchTypeStats } = usePortfolioStore();
  const { signals, market, agents, alerts, lastUpdate } = useSignalsStore();
  const { config } = useConfigStore();
  const [tab, setTab] = useState<'open' | 'hist'>('open');
  const [latestDecisions, setLatestDecisions] = useState<DecisionItem[]>([]);
  const lastStatsFetchRef = useRef(0);
  const lastDecisionsFetchRef = useRef(0);
  const api = import.meta.env.VITE_API_URL || '/api';

  useEffect(() => {
    const now = Date.now();
    if (lastStatsFetchRef.current && now - lastStatsFetchRef.current < STATS_REFRESH_MS) return;
    lastStatsFetchRef.current = now;
    void fetchTypeStats();
  }, [fetchTypeStats, lastUpdate]);

  useEffect(() => {
    const now = Date.now();
    // refresh décisions au moins toutes les 60s ou sur lastUpdate WS
    if (lastDecisionsFetchRef.current && now - lastDecisionsFetchRef.current < 60_000) return;
    lastDecisionsFetchRef.current = now;
    fetch(`${api}/decisions/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DecisionsLatestResponse | null) => {
        if (d) setLatestDecisions(d.decisions || []);
      })
      .catch(() => {});
  }, [api, lastUpdate]);

  const nav = portfolio.total_usd;
  const pnl = portfolio.daily_pnl_pct;
  const positions = portfolio.positions;

  const startingValue = portfolio.initial_capital || 10000;
  const totalPnl = nav - startingValue;
  const totalPnlPct = startingValue > 0 ? (totalPnl / startingValue) * 100 : 0;

  // Build curve from real trade history
  const curve = useMemo(() => {
    if (history.length === 0) return [startingValue];
    const sorted = [...history]
      .filter((t) => t.closedAt)
      .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());
    let v = startingValue;
    const out = [v];
    for (const t of sorted) {
      v += t.pnlUsd || 0;
      out.push(v);
    }
    return out;
  }, [history, startingValue]);

  // Real allocation from open positions
  const allocation = useMemo(() => {
    if (positions.length === 0) return [{ label: 'Cash', pct: 100, color: 'var(--ink-4)' }];
    const byAsset: Record<string, number> = {};
    for (const p of positions) {
      byAsset[p.ticker] = (byAsset[p.ticker] || 0) + p.sizeUsd;
    }
    const invested = positions.reduce((s, p) => s + p.sizeUsd, 0);
    const cashPct = nav > 0 ? Math.max(0, (portfolio.cash_usd / nav) * 100) : 0;
    const items = Object.entries(byAsset).map(([ticker, usd]) => ({
      label: ticker,
      pct: nav > 0 ? (usd / nav) * 100 : 0,
      color: 'var(--accent)',
    }));
    if (cashPct > 0) items.push({ label: 'Cash', pct: cashPct, color: 'var(--ink-4)' });
    return items;
  }, [positions, nav, portfolio.cash_usd]);

  // Real metrics from history
  const metrics = useMemo(() => {
    const closed = history.filter((t) => t.closedAt && t.pnlUsd !== null);
    const wins = closed.filter((t) => (t.pnlUsd || 0) > 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    let peak = startingValue;
    let maxDD = 0;
    for (const v of curve) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? ((v - peak) / peak) * 100 : 0;
      if (dd < maxDD) maxDD = dd;
    }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTrades = closed.filter((t) => new Date(t.closedAt!).getTime() > thirtyDaysAgo);

    return { winRate, maxDD: maxDD.toFixed(1), totalTrades: closed.length, tradesPerMonth: recentTrades.length };
  }, [history, curve, startingValue]);

  const openPositions = positions.map((p) => {
    const sig = signals.find((s) => s.ticker === p.ticker);
    return {
      sym: p.ticker, side: 'LONG' as const, qty: p.quantity, entry: p.entryPrice, mark: p.currentPrice,
      pnl: p.pnlUsd, pct: p.pnlPct, signal: sig?.signal || 'HOLD', confidence: sig?.confidence || 0, reasoning: sig?.reasoning || '',
    };
  });

  const lastUpdateStr = useMemo(() => {
    if (!lastUpdate) return '—';
    const diff = Date.now() - new Date(lastUpdate).getTime();
    if (diff < 5000) return 'à l\'instant';
    if (diff < 60000) return `il y a ${Math.floor(diff / 1000)}s`;
    if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)}min`;
    return `il y a ${Math.floor(diff / 3600000)}h`;
  }, [lastUpdate]);

  // Pipeline progress (5 étapes)
  const completedSteps = PIPELINE.filter((a) => (agents as any)[a.id]?.status === 'ok').length;
  const isCycleActive = PIPELINE.some((a) => (agents as any)[a.id]?.status === 'running');

  // Sector biases from market data
  const sectorList = useMemo(() => {
    const biases = (market as any).sector_biases as Record<string, SectorBias> | undefined;
    if (!biases) return [];
    return Object.values(biases).sort((a, b) => b.change_pct - a.change_pct);
  }, [market]);

  // VIX and Fear/Greed labels
  const vixInfo = vixLabel(market.vix || 0);
  const fgInfo = fearGreedLabel(market.fear_greed || 0);
  const macroInfo = macroRegimeLabel((market as any).macro?.macro_regime || 'NEUTRE');
  const dataInfo = freshnessLabel(market.data_freshness?.status);

  // Active alerts (critical + warning only)
  const activeAlerts = alerts.filter((a) => a.level === 'critical' || a.level === 'warning');

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Tableau de bord</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Vue synthétique du portefeuille, du marché et des décisions LLM en temps réel.
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('portfolio')}>Voir le portefeuille</button>
        </div>
      </div>

      {/* Alertes banner */}
      {activeAlerts.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeAlerts.map((alert) => (
            <div key={alert.id} className="card" style={{
              padding: '12px 18px',
              background: alert.level === 'critical' ? 'var(--danger-soft)' : 'var(--warn-soft)',
              borderColor: alert.level === 'critical' ? 'var(--danger)' : 'var(--warn)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>{alert.level === 'critical' ? '🚨' : '⚠️'}</span>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{alert.message}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => useSignalsStore.getState().removeAlert(alert.id)} style={{ minWidth: 24 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, borderColor: dataInfo.color }}>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, alignItems: 'center' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Lecture simple</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              {portfolio.risk_regime === 'NORMAL' && market.nasdaq !== 'bearish'
                ? 'L’IA peut chercher des opportunités, sans forcer.'
                : portfolio.risk_regime === 'NORMAL'
                  ? 'L’IA observe un marché mitigé et doit rester sélective.'
                  : 'L’IA doit protéger le capital avant de chercher du rendement.'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Les indices européens sont disponibles via Twelve Data. Les actions US gratuites, dont Polygon FREE, peuvent être limitées ou différées.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 8, display: 'grid', placeItems: 'center',
              border: `1px solid ${dataInfo.color}`, background: 'var(--bg-elev-2)', color: dataInfo.color,
              fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
            }}>
              {market.data_freshness?.score ?? 0}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: dataInfo.color }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{dataInfo.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>{dataInfo.text}</div>
              {market.data_freshness?.sources && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {market.data_freshness.sources.slice(0, 4).map((source) => {
                    const info = freshnessLabel(source.status);
                    return (
                      <span key={source.source} className="mono" title={source.message} style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        border: `1px solid ${info.color}`, color: info.color,
                      }}>
                        {source.source}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="kpi" style={{ paddingBottom: 0 }}>
            <div className="kpi-label">Valeur du portefeuille <Help tip="Capital total : positions ouvertes + liquidités." /></div>
            <div className="kpi-value">${nav.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
            <div className="kpi-sub" style={{ color: totalPnlPct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
              {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}% depuis le début · {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
            </div>
          </div>
          {curve.length > 1 ? (
            <div style={{ padding: '12px 20px 16px' }}>
              <Sparkline data={curve} w={500} h={48} fill={true} color={totalPnl >= 0 ? 'var(--accent)' : 'var(--danger)'} />
            </div>
          ) : (
            <div style={{ padding: '12px 20px 16px', color: 'var(--ink-4)', fontSize: 11 }}>
              Courbe P&L : pas encore de trades fermés
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="kpi-label">P&L jour <Help tip="Gain ou perte de la journée." /></div>
          <div className="kpi-value" style={{ color: pnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</div>
          <div className="kpi-sub">{pnl >= 0 ? '+' : ''}${((nav * pnl) / 100).toFixed(2)} aujourd'hui</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Positions ouvertes <Help tip="Nombre de positions détenues par les agents IA." /></div>
          <div className="kpi-value">{positions.length}</div>
          <div className="kpi-sub">{positions.length > 0 ? ((positions.reduce((s, p) => s + p.sizeUsd, 0) / nav) * 100).toFixed(1) : '0'}% du capital engagé</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Risque <Help tip="NORMAL=ok, ELEVATED=perte>2%, CRISIS=perte>3%, DRAWDOWN=-10% pic, SEVERE=-15% pic" /></div>
          <div className="kpi-value" style={{
            color: portfolio.risk_regime === 'NORMAL' ? 'var(--accent)' : portfolio.risk_regime === 'ELEVATED' ? 'var(--warn)' : 'var(--danger)',
            fontFamily: 'var(--mono)', fontSize: 28,
          }}>{portfolio.risk_regime}</div>
          {portfolio.drawdown_from_peak_pct !== 0 && (
            <div className="kpi-sub" style={{ color: portfolio.drawdown_from_peak_pct <= -5 ? 'var(--danger)' : 'var(--ink-3)' }}>
              Pic -{Math.abs(portfolio.drawdown_from_peak_pct).toFixed(1)}%
            </div>
          )}
          {!portfolio.drawdown_from_peak_pct && <div className="kpi-sub">{lastUpdateStr}</div>}
        </div>
      </div>

      {/* Contexte Marché */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div className="card-h-title">Contexte Marché <Help tip="Indicateurs globaux qui influencent les décisions de l'IA. En vert = favorable, en rouge = défavorable." /></div>
          <span className="card-h-meta">
            {market.global_market_status?.isOpen
              ? `Ouvert (${market.global_market_status.region === 'US' ? 'US' : 'EU'})`
              : market.global_market_status?.nextOpen || market.nasdaq_status?.nextOpen || 'Fermé'}
          </span>
        </div>
        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
          {/* VIX */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>VIX</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{market.vix > 0 ? market.vix.toFixed(1) : '—'}</div>
            <div style={{ fontSize: 12, color: vixInfo.color, marginTop: 2 }}>{market.vix > 0 ? vixInfo.text : ''}</div>
          </div>
          {/* Fear & Greed */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fear & Greed</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{market.fear_greed > 0 ? market.fear_greed : '—'}</div>
            <div style={{ fontSize: 12, color: fgInfo.color, marginTop: 2 }}>{market.fear_greed > 0 ? fgInfo.text : ''}</div>
          </div>
          {/* NASDAQ */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>NASDAQ</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: market.nasdaq_change_pct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
              {market.nasdaq_change_pct !== 0 ? `${market.nasdaq_change_pct >= 0 ? '+' : ''}${market.nasdaq_change_pct.toFixed(2)}%` : '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {market.nasdaq === 'bullish' ? 'Tendance haussière' : market.nasdaq === 'bearish' ? 'Tendance baissière' : 'Neutre'}
            </div>
          </div>
          {/* Macro regime */}
          {(market as any).macro && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Macro</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)',
                  background: macroInfo.color + '22', color: macroInfo.color,
                }}>{(market as any).macro.macro_regime || 'NEUTRE'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>{macroInfo.text}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4 }}>
                Fed {(market as any).macro.fed_funds_rate ?? '—'}% · Courbe {(market as any).macro.yield_curve != null ? `${(market as any).macro.yield_curve > 0 ? '+' : ''}${(market as any).macro.yield_curve}` : '—'}% · CPI {(market as any).macro.cpi_yoy ?? '—'}
              </div>
            </div>
          )}
          {/* CAC 40 */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>CAC 40</div>
            {(market as any).eu?.cac40_change_pct != null ? (() => {
              const v = (market as any).eu.cac40_change_pct as number;
              return (
                <>
                  <div style={{ fontSize: 20, fontWeight: 600, color: v >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {v >= 0 ? '+' : ''}{v.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 12, color: v >= 0 ? 'var(--accent)' : 'var(--danger)', marginTop: 2 }}>
                    {v >= 0 ? 'Hausse' : 'Baisse'}
                  </div>
                </>
              );
            })() : (
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-4)' }}>—</div>
            )}
          </div>
          {/* DAX */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>DAX</div>
            {(market as any).eu?.dax_change_pct != null ? (() => {
              const v = (market as any).eu.dax_change_pct as number;
              return (
                <>
                  <div style={{ fontSize: 20, fontWeight: 600, color: v >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {v >= 0 ? '+' : ''}{v.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 12, color: v >= 0 ? 'var(--accent)' : 'var(--danger)', marginTop: 2 }}>
                    {v >= 0 ? 'Hausse' : 'Baisse'}
                  </div>
                </>
              );
            })() : (
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-4)' }}>—</div>
            )}
          </div>
          {/* FTSE 100 */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>FTSE 100</div>
            {(market as any).eu?.ftse100_change_pct != null ? (() => {
              const v = (market as any).eu.ftse100_change_pct as number;
              return (
                <>
                  <div style={{ fontSize: 20, fontWeight: 600, color: v >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {v >= 0 ? '+' : ''}{v.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 12, color: v >= 0 ? 'var(--accent)' : 'var(--danger)', marginTop: 2 }}>
                    {v >= 0 ? 'Hausse' : 'Baisse'}
                  </div>
                </>
              );
            })() : (
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-4)' }}>—</div>
            )}
          </div>
          {/* Market status fallback when no macro */}
          {!(market as any).macro && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Statut</div>
              <div style={{ fontSize: 12, color: market.global_market_status?.isOpen ? 'var(--accent)' : 'var(--ink-3)' }}>
                {market.global_market_status?.isOpen
                  ? `Marché ouvert (${market.global_market_status.region === 'US' ? 'US' : 'EU'})`
                  : market.global_market_status?.nextOpen || market.nasdaq_status?.nextOpen || 'Marché fermé'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Signaux IA + Secteurs */}
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">Signaux IA <Help tip="Les recommandations des agents IA pour chaque action. Vert = acheter, rouge = vendre, orange = conserver." /></div>
            <span className="card-h-meta">{signals.length} tickers</span>
          </div>
          <div style={{ padding: 18 }}>
            {signals.length > 0 ? (
              <>
                <HeatMap signals={signals} />
                <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-4)' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', marginRight: 4 }} />Achat</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--warn)', marginRight: 4 }} />Conserver</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--danger)', marginRight: 4 }} />Vendre</span>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 24 }}>
                En attente des premiers signaux IA...
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">Secteurs <Help tip="Performance des grands secteurs du marché. En hausse = favorable, en baisse = défavorable." /></div>
          </div>
          <div style={{ padding: 18 }}>
            {sectorList.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sectorList.map((s) => (
                  <div key={s.sector} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13 }}>{s.direction === 'bullish' ? '↗' : s.direction === 'bearish' ? '↘' : '→'}</span>
                      <span style={{ fontSize: 13 }}>{s.sector}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: s.direction === 'bullish' ? 'var(--accent)' : s.direction === 'bearish' ? 'var(--danger)' : 'var(--ink-3)' }}>
                      {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(2)}%
                    </span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
                  ↗ En hausse · → Stable · ↘ En baisse
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 24 }}>
                Données secteurs en attente...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline de décision */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div className="card-h-title">
            Pipeline <Help tip="5 étapes par cycle. Une seule (Décideur) appelle le LLM ; les autres sont du calcul déterministe." />
          </div>
          <span className="card-h-meta">{isCycleActive ? 'En cours' : 'En attente'} · {completedSteps}/{PIPELINE.length}</span>
        </div>
        <div style={{ padding: '18px 20px' }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, height: 6 }}>
            {PIPELINE.map((a) => {
              const st = (agents as any)[a.id]?.status || 'idle';
              return (
                <div key={a.id} style={{
                  flex: 1, borderRadius: 3,
                  background: st === 'ok' ? 'var(--accent)' : st === 'running' ? 'var(--warn)' : 'var(--bg-elev-2)',
                  transition: 'background 0.3s',
                }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            {PIPELINE.map((a) => {
              const st = (agents as any)[a.id]?.status || 'idle';
              const icon = st === 'ok' ? '✓' : st === 'running' ? '⟳' : st === 'error' ? '✗' : '·';
              const color = st === 'ok' ? 'var(--accent)' : st === 'running' ? 'var(--warn)' : st === 'error' ? 'var(--danger)' : 'var(--ink-4)';
              return (
                <span key={a.id} style={{ fontSize: 12, color, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>{icon}</span>
                  <span>{a.name}</span>
                  {a.isLLM && (
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--mono)', fontWeight: 600,
                      background: 'oklch(0.74 0.10 280 / 0.2)', color: 'oklch(0.74 0.10 280)',
                    }}>LLM</span>
                  )}
                </span>
              );
            })}
          </div>
          {lastUpdate && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-4)' }}>
              Dernière mise à jour {lastUpdateStr}
            </div>
          )}
        </div>
      </div>

      {/* Dernières décisions LLM */}
      <DecisionsSummary decisions={latestDecisions} onSeeAll={() => onNavigate('agents')} />

      {/* Positions tabs */}
      <div className="card">
        <div className="card-h">
          <div className="flex gap-3 center">
            <button
              onClick={() => setTab('open')}
              style={{
                padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                color: tab === 'open' ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: tab === 'open' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Positions ouvertes <span style={{ color: 'var(--ink-4)' }}>({openPositions.length})</span>
            </button>
            <button
              onClick={() => setTab('hist')}
              style={{
                padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                color: tab === 'hist' ? 'var(--ink)' : 'var(--ink-3)',
                borderBottom: tab === 'hist' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Historique <span style={{ color: 'var(--ink-4)' }}>({history.length})</span>
            </button>
          </div>
          <span className="card-h-meta">{lastUpdateStr !== '—' ? `dernière MAJ ${lastUpdateStr}` : 'en attente de connexion'}</span>
        </div>

        {tab === 'open' && (
          <div>
            {openPositions.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucune position ouverte — le système IA attend les prochaines opportunités
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  <span>Actif</span><span>Sens</span><span>Qté</span><span>Entrée</span><span>Marché</span><span>Décision IA</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span>
                </div>
                {openPositions.map((p, i) => (
                  <div key={p.sym} style={{ display: 'grid', gridTemplateColumns: '90px 70px 70px 100px 100px 1fr 110px 90px', padding: '14px 18px', borderBottom: i < openPositions.length - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>{p.sym}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--accent-soft)', color: 'var(--accent)' }}>{p.side}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{p.qty.toFixed(2)}</span>
                    <span className="mono">${p.entry.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span className="mono">${p.mark.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--mono)', background: (SIGNAL_COLOR[p.signal] || 'var(--ink-4)').replace('var(', 'var(') + '15', color: SIGNAL_COLOR[p.signal] || 'var(--ink-4)' }}>
                        {SIGNAL_LABEL[p.signal] || p.signal}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {p.confidence > 0 ? `confiance ${p.confidence}%` : ''}
                      </span>
                    </span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: p.pnl >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</span>
                    <span className="mono" style={{ textAlign: 'right', color: p.pct >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{p.pct >= 0 ? '+' : ''}{p.pct.toFixed(2)}%</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'hist' && (
          <div>
            {history.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Aucun trade fermé
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 70px 70px 1fr 100px 80px', padding: '10px 18px', borderBottom: '1px solid var(--rule)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  <span>Date</span><span>Actif</span><span>Action</span><span>Raison</span><span style={{ textAlign: 'right' }}>P&L $</span><span style={{ textAlign: 'right' }}>P&L %</span>
                </div>
                {history.slice(0, 20).map((h, i) => (
                  <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '100px 70px 70px 1fr 100px 80px', padding: '14px 18px', borderBottom: i < Math.min(history.length, 20) - 1 ? '1px solid var(--rule)' : 'none', alignItems: 'center', fontSize: 13 }}>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{h.closedAt ? new Date(h.closedAt).toLocaleDateString('fr-FR') : '—'}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{h.ticker}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)', background: h.action === 'BUY' ? 'var(--accent-soft)' : 'var(--danger-soft)', color: h.action === 'BUY' ? 'var(--accent)' : 'var(--danger)' }}>{h.action}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{h.closeReason || '—'} {h.reasoning ? `· ${h.reasoning.slice(0, 40)}` : ''}</span>
                    <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{(h.pnlUsd || 0) >= 0 ? '+' : ''}${(h.pnlUsd || 0).toFixed(2)}</span>
                    <span className="mono" style={{ textAlign: 'right', color: (h.pnlUsd || 0) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                      {h.filledPrice > 0 && h.closePrice ? `${((h.closePrice - h.filledPrice) / h.filledPrice * 100 >= 0 ? '+' : '')}${((h.closePrice - h.filledPrice) / h.filledPrice * 100).toFixed(2)}%` : '—'}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Allocation <Help tip="Répartition du capital entre positions et liquidités." /></div></div>
          <div style={{ padding: 20 }}>
            {allocation.length === 0 || (allocation.length === 1 && allocation[0].label === 'Cash') ? (
              <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 16 }}>
                100% en liquidités — aucun trade actif
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-elev-2)', marginBottom: 18 }}>
                  {allocation.map((a, i) => (
                    <div key={a.label} style={{ width: `${Math.max(a.pct, 2)}%`, background: a.color }} title={`${a.label}: ${a.pct.toFixed(1)}%`} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(allocation.length, 5)}, 1fr)`, gap: 12 }}>
                  {allocation.map((a) => (
                    <div key={a.label}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{a.label}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 14 }}>{a.pct.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><div className="card-h-title">Indicateurs clés <Help tip="Mesures calculées à partir de l'historique réel des trades." /></div></div>
          <div style={{ padding: 6 }}>
            {metrics.totalTrades === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                Pas encore de trades — les indicateurs apparaîtront avec les premières décisions
              </div>
            ) : (
              [
                ['Win rate', `${metrics.winRate.toFixed(0)}%`, 'Pourcentage de trades fermés en gain.'],
                ['Drawdown pic', `${metrics.maxDD}%`, 'Pire chute depuis le sommet du portefeuille.'],
                ['Trades fermés', `${metrics.totalTrades}`, 'Nombre total de trades fermés.'],
                ['Trades / mois', `${metrics.tradesPerMonth}`, 'Trades fermés dans les 30 derniers jours.'],
              ].map(([k, v, tip], i) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: i < 3 ? '1px solid var(--rule)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{k as string}</span>
                    <Help tip={tip as string} />
                  </div>
                  <span className="mono" style={{ fontWeight: 600 }}>{v as string}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Performance par type de trade */}
      {typeStats && typeStats.overall.total_trades > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h">
            <div className="card-h-title">Performance par type <Help tip="Type A = Tendance, Type B = Swing, Type C = Range. Statistiques basées sur les trades fermés." /></div>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {Object.entries(typeStats.by_type).map(([type, stats]) => {
                const label = type === 'A' ? 'Tendance (A)' : type === 'B' ? 'Swing (B)' : type === 'C' ? 'Range (C)' : type;
                const color = stats.win_rate >= 55 ? 'var(--accent)' : stats.win_rate >= 45 ? 'var(--warn)' : 'var(--danger)';
                return (
                  <div key={type} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-elev-2)' }}>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                    <div className="mono" style={{ fontSize: 22, fontWeight: 700, color }}>{stats.win_rate.toFixed(0)}%</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                      {stats.trades} trades · P&L {stats.total_pnl >= 0 ? '+' : ''}{stats.total_pnl.toFixed(0)}$
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                      Moy. {stats.avg_pnl >= 0 ? '+' : ''}{stats.avg_pnl.toFixed(1)}$ · Hold {stats.avg_hold_hours.toFixed(0)}h
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-elev-2)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Global</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: typeStats.overall.win_rate >= 50 ? 'var(--accent)' : 'var(--danger)' }}>
                  {typeStats.overall.win_rate.toFixed(0)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  {typeStats.overall.total_trades} trades · P&L {typeStats.overall.total_pnl >= 0 ? '+' : ''}{typeStats.overall.total_pnl.toFixed(0)}$
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                  DD pic max {typeStats.overall.max_drawdown_pct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Synthèse des dernières décisions LLM du cycle en cours.
 * Affiche compteurs BUY/SELL/HOLD + 3 dernières décisions BUY/SELL avec reasoning court.
 * Cliquer "Voir tout" navigue vers la page Décisions LLM.
 */
function DecisionsSummary({ decisions, onSeeAll }: { decisions: DecisionItem[]; onSeeAll: () => void }) {
  const counts = useMemo(() => ({
    BUY: decisions.filter((d) => d.action === 'BUY').length,
    SELL: decisions.filter((d) => d.action === 'SELL').length,
    HOLD: decisions.filter((d) => d.action === 'HOLD').length,
  }), [decisions]);

  // Top 3 décisions actionnables (BUY puis SELL, par confidence)
  const actionable = useMemo(() => {
    const buys = decisions.filter((d) => d.action === 'BUY').sort((a, b) => b.confidence - a.confidence);
    const sells = decisions.filter((d) => d.action === 'SELL').sort((a, b) => b.confidence - a.confidence);
    return [...buys, ...sells].slice(0, 3);
  }, [decisions]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <div className="card-h-title">
          Dernières décisions LLM <Help tip="Le Décideur a réfléchi à partir de toutes les infos (indicateurs, news, macro, portfolio) et a choisi pour chaque ticker BUY, SELL ou HOLD." />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onSeeAll}>Voir tout →</button>
      </div>
      <div style={{ padding: 18 }}>
        {decisions.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>
            En attente du prochain cycle — le LLM décidera puis les choix apparaîtront ici.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
              <div style={{ padding: '10px 12px', background: 'var(--bg-elev-2)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
                <div className="eyebrow">Achats</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{counts.BUY}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-elev-2)', borderRadius: 6, borderLeft: '3px solid var(--danger)' }}>
                <div className="eyebrow">Ventes</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--danger)' }}>{counts.SELL}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-elev-2)', borderRadius: 6, borderLeft: '3px solid var(--ink-3)' }}>
                <div className="eyebrow">Attentes</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-3)' }}>{counts.HOLD}</div>
              </div>
            </div>

            {actionable.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actionable.map((d) => {
                  const col = d.action === 'BUY' ? 'var(--accent)' : 'var(--danger)';
                  const label = d.action === 'BUY' ? 'ACHAT' : 'VENTE';
                  return (
                    <div key={`${d.ticker}-${d.timestamp}`} style={{
                      display: 'grid', gridTemplateColumns: '70px 60px 1fr 80px', gap: 10, alignItems: 'center',
                      padding: '10px 12px', borderRadius: 6, background: 'var(--bg-elev-2)', borderLeft: `3px solid ${col}`,
                    }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{d.ticker}</span>
                      <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, background: col + '22', color: col, textAlign: 'center' }}>
                        {label}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.reasoning}
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', textAlign: 'right' }}>
                        conf {d.confidence}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, padding: 10 }}>
                Le LLM a choisi d'attendre sur tous les tickers ce cycle.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Sparkline({ data, color = 'var(--accent)', w = 120, h = 32, fill = false }: { data: number[]; color?: string; w?: number; h?: number; fill?: boolean }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const r = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / r) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {fill && <polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.15" stroke="none" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
