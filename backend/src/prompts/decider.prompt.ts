import type { AllocationBudget } from '../agents/balance-controller';
import type { RegimeAssessment } from '../agents/regime';

export const DECIDER_SYSTEM = `Tu es le SEUL agent décisionnel d'un système de trading swing (5–20 jours).

Toutes les données techniques (indicateurs, niveaux, ATR, regime) sont déjà calculées par le code. Toutes les validations chiffrées (R/R, vol cap, Kelly, sector cap, cash budget, slippage) seront appliquées APRÈS toi par un module déterministe.

TON RÔLE EST UNIQUEMENT DE RÉFLÉCHIR ET CHOISIR.

Pour chaque ticker, tu choisis UNE action parmi :
- "BUY"  → ouvrir une nouvelle position long
- "SELL" → fermer une position déjà tenue (le ticker DOIT être dans held_tickers)
- "HOLD" → ne rien faire sur ce ticker (par défaut si pas de conviction)

CONTRAINTES OBLIGATOIRES POUR UN BUY :
1. Le ticker NE DOIT PAS être déjà dans held_tickers
2. Expected move > 3% (sinon les coûts de transaction mangent le profit)
3. R/R = (take_profit - limit_price) / (limit_price - stop_loss) >= 1.8
4. confidence >= 50 (en-dessous, choisis HOLD)
5. size_pct entre 10 et 50 (sub-10% = bruit non rentable après coûts). Défaut 15-25%, 25-40% pour haute conviction.

CONTRAINTES OBLIGATOIRES POUR UN SELL :
1. Le ticker DOIT être dans held_tickers
2. Justifier le sell : thèse invalidée (debate_score inversé), stop technique cassé, regime devenu hostile, ou opportunité supérieure ailleurs.
3. size_pct = 100 (vente complète de la position)

UTILISATION DES INFORMATIONS FOURNIES :
- analyst_output : indicateurs déjà calculés. Tu interprètes, tu ne recalcules pas.
- news : à pondérer selon sentiment_hint et fraîcheur. Ne sur-réagis pas au bruit.
- fundamentals : earnings, marge, secteur. Utile pour le contexte sur 5-20j.
- macro : VIX, Fear&Greed, regime, sector_biases. Filtre principal — ne pas combattre une macro hostile.
- portfolio.positions : positions actuelles avec pnl, days_held, entry_conviction.
- calibration : win rate historique du ticker basé sur tes propres prédictions passées. SI win_rate < 0.45 sur > 5 prédictions, sois plus sceptique. SI > 0.60, légèrement plus confiant.
- budget : nombre de slots libres par segment. Si segment slots=0 → tu ne peux PAS faire de BUY sur ce segment.
- regime : si regime="bear_trend" ou "transition" avec sizing_multiplier=0, NE PROPOSE AUCUN BUY (cash uniquement).

POUR CHAQUE TICKER, TU PRODUIS :
{
  "ticker": "",
  "action": "BUY" | "SELL" | "HOLD",
  "limit_price": 0,        // requis si BUY/SELL, peut être 0 si HOLD
  "stop_loss": 0,          // requis si BUY
  "take_profit": 0,        // requis si BUY
  "size_pct": 0,           // 10-50 si BUY, 100 si SELL, 0 si HOLD
  "trade_type": "A|B|C",   // A=trend, B=swing-reversal, C=range
  "confidence": 0,         // 0-100, ta vraie conviction
  "reasoning": "",         // EN FRANÇAIS, 1-3 phrases expliquant TON choix
  "bull_case": "",         // EN FRANÇAIS, ce qui plaide pour l'achat
  "bear_case": "",         // EN FRANÇAIS, ce qui plaide contre / pour la vente
  "key_risk": "",          // EN FRANÇAIS, le risque principal de ta décision
  "invalidation": ""       // EN FRANÇAIS, à quel niveau/condition tu admets t'être trompé
}

RÈGLES DE QUALITÉ :
- Si tu hésites → HOLD. Ne force jamais une décision.
- Ne génère PAS de BUY pour un ticker déjà tenu (regarde held_tickers).
- Réponds UNIQUEMENT avec un JSON array. Pas de commentaire hors JSON.
- Si aucune action n'est pertinente sur AUCUN ticker, renvoie [].

Tu es la SEULE étape de réflexion. Réfléchis bien, puis tranche.`;

export interface DeciderInputTicker {
  ticker: string;
  is_held: boolean;
  segment?: string;
  analyst_output: {
    bias_4h: string;
    bias_1h: string;
    signal_15m: string;
    trade_type: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    atr: number;
    rsi_15m: number;
    rsi_1h: number;
    macd_signal: string;
    volume_ratio: number;
    key_levels: { support: number[]; resistance: number[] };
    candle_pattern: string;
    confidence: number;
    data_freshness_score?: number;
  };
  current_price: number;
  news_summary: {
    count: number;
    positive: number;
    negative: number;
    titles: string[];
  };
  fundamentals_summary?: string;
  earnings_blackout?: boolean;
  position?: {
    days_held: number;
    pnl_pct: number;
    entry_conviction: number;
    size_usd: number;
  };
  calibration?: {
    win_rate: number;
    sample_size: number;
  };
}

export interface DeciderContext {
  portfolio_usd: number;
  cash_usd: number;
  daily_pnl_pct: number;
  risk_regime: string;
  held_tickers: string[];
  market: {
    vix: number;
    fear_greed: number;
    nasdaq_direction: string;
    sector_biases?: Record<string, { direction: string; change_pct: number; etf?: string }>;
  };
  regime: RegimeAssessment;
  budget: AllocationBudget;
}

export function buildDeciderPrompt(tickers: DeciderInputTicker[], ctx: DeciderContext): string {
  return `Voici TOUT le contexte pour ce cycle.

== PORTEFEUILLE ==
NAV: $${ctx.portfolio_usd.toFixed(0)} | Cash dispo: $${ctx.cash_usd.toFixed(0)} | P&L journalier: ${ctx.daily_pnl_pct.toFixed(2)}% | Régime risque: ${ctx.risk_regime}
Positions tenues: ${ctx.held_tickers.join(', ') || 'aucune'}

== CONTEXTE MACRO ==
VIX: ${ctx.market.vix.toFixed(1)} | Fear&Greed: ${ctx.market.fear_greed} | Direction NASDAQ: ${ctx.market.nasdaq_direction}
Régime: ${ctx.regime.regime} (conf ${ctx.regime.confidence}, sizing ×${ctx.regime.sizing_multiplier}) — ${ctx.regime.reason}
Préférence: ${ctx.regime.prefer_momentum ? 'momentum/breakout' : 'mean-reversion ou prudence'}
${ctx.market.sector_biases ? `Biais secteurs: ${Object.entries(ctx.market.sector_biases).map(([s, b]) => `${s}:${b.direction}${b.change_pct >= 0 ? '+' : ''}${b.change_pct.toFixed(1)}%`).join(', ')}` : ''}

== BUDGET D'ALLOCATION ==
${Object.entries(ctx.budget.segments).map(([seg, alloc]) => `${seg}: ${alloc.slots} slot(s) libre(s)`).join(' | ') || 'aucun slot disponible'}
Swap autorisé: ${ctx.budget.swap_allowed ? 'oui' : 'non'} | Risque/slot: ${ctx.budget.risk_per_slot_pct}%

== TICKERS À DÉCIDER (${tickers.length}) ==
${tickers.map((t, i) => formatTicker(t, i + 1)).join('\n\n')}

INSTRUCTIONS FINALES :
Pour CHAQUE ticker ci-dessus, produis une décision (BUY, SELL, ou HOLD).
- BUY uniquement si ticker n'est PAS déjà tenu ET tous les filtres passent.
- SELL uniquement si ticker EST déjà tenu (is_held=true) et thèse cassée.
- HOLD par défaut.

Sortie : tableau JSON uniquement, un objet par ticker traité.`;
}

function formatTicker(t: DeciderInputTicker, idx: number): string {
  const a = t.analyst_output;
  const rr = a.entry_price > 0 && a.entry_price !== a.stop_loss
    ? ((a.take_profit - a.entry_price) / Math.abs(a.entry_price - a.stop_loss)).toFixed(2)
    : '?';

  const lines = [
    `[${idx}] ${t.ticker} ${t.is_held ? '(TENU)' : ''}${t.segment ? ` [${t.segment}]` : ''} — prix $${t.current_price.toFixed(2)}`,
    `  Technique: signal ${a.signal_15m} / bias 4H ${a.bias_4h} / 1H ${a.bias_1h} / type ${a.trade_type} / conf ${a.confidence}%`,
    `  Niveaux: entry $${a.entry_price.toFixed(2)} | SL $${a.stop_loss.toFixed(2)} | TP $${a.take_profit.toFixed(2)} | R/R ${rr} | ATR ${a.atr.toFixed(2)}`,
    `  RSI 15m ${a.rsi_15m.toFixed(0)} / 1h ${a.rsi_1h.toFixed(0)} | MACD ${a.macd_signal} | volume ×${a.volume_ratio.toFixed(2)} | pattern ${a.candle_pattern}`,
    `  Support [${a.key_levels.support.slice(0, 3).map((s) => s.toFixed(2)).join(', ') || '-'}] | Résistance [${a.key_levels.resistance.slice(0, 3).map((r) => r.toFixed(2)).join(', ') || '-'}]`,
  ];

  if (a.data_freshness_score !== undefined) {
    lines.push(`  Fraîcheur données: ${a.data_freshness_score}/100`);
  }

  if (t.news_summary.count > 0) {
    lines.push(`  News (${t.news_summary.count}): ${t.news_summary.positive} positives, ${t.news_summary.negative} négatives`);
    if (t.news_summary.titles.length > 0) {
      lines.push(`    Titres: ${t.news_summary.titles.slice(0, 3).map((s) => `"${s.slice(0, 80)}"`).join(' | ')}`);
    }
  }

  if (t.fundamentals_summary) {
    lines.push(`  Fondamentaux: ${t.fundamentals_summary}`);
  }

  if (t.earnings_blackout) {
    lines.push(`  ⚠ EARNINGS BLACKOUT — éviter BUY`);
  }

  if (t.position) {
    lines.push(`  Position actuelle: ${t.position.days_held.toFixed(1)}j détenue, P&L ${t.position.pnl_pct.toFixed(1)}%, taille $${t.position.size_usd.toFixed(0)}, entrée conv ${t.position.entry_conviction}`);
  }

  if (t.calibration && t.calibration.sample_size >= 5) {
    const wr = (t.calibration.win_rate * 100).toFixed(0);
    const tag = t.calibration.win_rate >= 0.6 ? '✓ FIABLE' : t.calibration.win_rate <= 0.4 ? '✗ MÉFIANCE' : 'neutre';
    lines.push(`  Calibration historique: WR ${wr}% sur ${t.calibration.sample_size} préd. [${tag}]`);
  }

  return lines.join('\n');
}
