import type { AllocationBudget } from '../agents/balance-controller';
import type { SwapCandidate } from '../agents/strategist';
import type { RegimeAssessment } from '../agents/regime';

export const STRATEGIST_SYSTEM = `You are the MEDIUM-TERM trading decision agent. Synthesize analyst signals, bull/bear debate outcomes, and portfolio state to generate actionable trade orders.

CRITICAL CONSTRAINT: Transaction costs (~0.1-0.5% per trade) make frequent trading unprofitable. Target swing trades with 5-20 day holds. FEWER, HIGHER-CONVICTION trades are strongly preferred.

REGIME-AWARE DECISION LOGIC (apply in order):
1. SKIP if data_quality = "missing" or earnings_blackout = true
2. SKIP if expected price move < 3% (insufficient to absorb transaction costs)
2b. Set limit_price, stop_loss, take_profit so that Risk/Reward = (take_profit - limit_price) / (limit_price - stop_loss) >= 2.0 MINIMUM. Target >= 2.5 for Type A/B trades.
3. Compute debate_score = bull_conviction - bear_conviction
   - debate_score >= 1 → strong BUY signal
   - debate_score <= 0 → consider HOLD or SKIP unless regime favors contrarian entries
4. Apply trade type targets:
   - Type A: target 5-15 day hold
   - Type B: target 5-10 day hold
   - Type C: target 3-8 day hold
5. SIZE_PCT (regime-aware): For normal setups set size_pct between 5 and 50. For PULLBACK/CONTRARIAN setups reduce to 3-15. For MEAN_REVERSION setups reduce to 2-10.
6. Do NOT generate duplicate orders for already-held positions.
7. For SWAP orders: action="SWAP", ticker=new_ticker, swap_sell_ticker=old_ticker_to_sell
   A SWAP is valid only if: new conviction > old entry_conviction + 20 points AND days_held >= 2 AND current pnl < +8%
8. REGIME vs BIAS CONTRARIAN LOGIC (REWRITTEN — do NOT use old skip logic):
   If regime = "bull_trend" and bias_4h = "BEARISH" → DO NOT skip. This is a PULLBACK ENTRY opportunity. Set trade_type="B", reduce size_pct to 3-15, confidence >= 45.
   If regime = "bull_range" and bias_4h = "BEARISH" → DO NOT skip if volume_ratio > 1.2. This is a MEAN_REVERSION buy at support. Set trade_type="C", size_pct 2-10, confidence >= 40.
   Only skip if: bias_4h="BEARISH" AND bias_1h="BEARISH" AND regime="bear_trend" (full downtrend alignment). In all other regime/bias combos, attempt to find an entry setup.
9. SKIP BUY for NASDAQ/US tickers if market context indicates US market is closed (check market.internals or segment budget slots = 0 for nasdaq).
10. CONFIDENCE THRESHOLDS (relaxed for volume-confirmed setups):
   - Type A (trend): min confidence 55
   - Type B (pullback): min confidence 45
   - Type C (mean-reversion/range): min confidence 40
   - NEUTRAL bias with volume_ratio > 1.5 OR candle_pattern detected: min confidence 40
   - If volume_ratio < 0.7: add +10 to min confidence required

MARKET CONTEXT USAGE:
- Use market.internals.risk_regime and sector_momentum to avoid fighting broad equity flows.
- Prefer smaller size_pct when market internals are RISK_OFF.

POSITION EXIT RULES (apply to HELD positions before generating new BUY orders):
11. SELL held position if debate_score <= -2 for that ticker (thesis invalidated, bear dominates).
12. SELL held position if flat (|pnl_pct| < 1%) AND days_held >= 70% of trade_type max hold (A=15, B=10, C=8 days) — time decay, thesis not playing out.
13. SELL held position if sector bias is BEARISH AND position pnl < 0 — hostile environment, capital better deployed elsewhere.
14. When generating SELL exits, include the exit reason in the "reasoning" field and set action="SELL", size_pct=100.
PORTFOLIO-LEVEL THINKING:
15. Compare ALL held positions against ALL buy candidates. If a held position scores LOWER than a buy candidate by 30+ conviction points AND the held position is underperforming (pnl < -3% or days_held >= 3 with pnl < 0), consider SELLING to free capital for the better opportunity.
16. Total portfolio risk (sum of all position risk distances to stop_loss) MUST NOT exceed 8% of portfolio NAV. If it does, prioritize which positions to keep and which to exit.

IMPORTANT: The "reasoning" field MUST be written in French.

Output: JSON array of order proposals. Generate at least 1 proposal if ANY setup meets the relaxed thresholds above. Empty array only if truly nothing qualifies.

Order format:
{
  "ticker": "",
  "action": "BUY|SELL|SWAP",
  "swap_sell_ticker": "",
  "trade_type": "A|B|C",
  "limit_price": 0,
  "stop_loss": 0,
  "take_profit": 0,
  "invalidation_condition": "",
  "size_pct": 0,
  "confidence": 0,
  "debate_score": 0,
  "bull_conviction": 0,
  "bear_conviction": 0,
  "reasoning": ""
}`;

interface DebateLike {
  ticker: string;
  debate_score: number;
  bull: { conviction: number; technical_case: string; upside_pct: number };
  bear: { conviction: number; technical_case: string; downside_pct: number };
  analyst_output: {
    signal_15m: string;
    bias_4h: string;
    bias_1h: string;
    confidence: number;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    rsi_15m: number;
    volume_ratio: number;
    candle_pattern: string;
    trade_type: string;
    atr: number;
    data_quality?: string;
    earnings_blackout?: boolean;
  };
}

function buildCompactDebateRow(d: DebateLike): string {
  const a = d.analyst_output;
  const rr = a.entry_price > 0 && a.entry_price !== a.stop_loss
    ? ((a.take_profit - a.entry_price) / Math.abs(a.entry_price - a.stop_loss)).toFixed(1)
    : '?';
  const bullShort = d.bull.technical_case.slice(0, 80).replace(/\n/g, ' ');
  const bearShort = d.bear.technical_case.slice(0, 80).replace(/\n/g, ' ');
  return [
    d.ticker,
    `${a.signal_15m}/${a.bias_4h}/${a.bias_1h}`,
    `conf=${a.confidence}`,
    `score=${d.debate_score}(B${d.bull.conviction}/b${d.bear.conviction})`,
    `p=${a.entry_price} sl=${a.stop_loss} tp=${a.take_profit} rr=${rr}`,
    `rsi=${a.rsi_15m} vol=${a.volume_ratio?.toFixed(1)} pat=${a.candle_pattern} type=${a.trade_type}`,
    `BULL: ${bullShort}`,
    `BEAR: ${bearShort}`,
  ].join(' | ');
}

export function buildStrategistPrompt(data: {
  debates: unknown[];
  portfolio: unknown;
  market: unknown;
  held_tickers: string[];
  budget?: AllocationBudget;
  swapCandidates?: SwapCandidate[];
  regime?: RegimeAssessment;
}): string {
  const debates = data.debates as DebateLike[];

  // Compact portfolio: include position-level data for portfolio-level decisions
  const port = data.portfolio as Record<string, unknown>;
  const positions = Array.isArray(port.positions) ? port.positions as any[] : [];
  const compactPortfolio = {
    cash_usd: port.cash_usd,
    total_usd: port.total_usd,
    daily_pnl_pct: port.daily_pnl_pct,
    risk_regime: port.risk_regime,
    positions_count: positions.length,
    positions: positions.map((p) => ({
      ticker: p.ticker,
      pnl_pct: Math.round((p.pnlPct ?? 0) * 10) / 10,
      days_held: Math.round((p.days_held ?? 0) * 10) / 10,
      size_pct: port.total_usd && p.sizeUsd ? Math.round((p.sizeUsd / (port.total_usd as number)) * 100 * 10) / 10 : 0,
      entry_conviction: p.entry_conviction ?? 50,
      stop_distance_pct: p.entryPrice && p.stopLoss && p.entryPrice > 0
        ? Math.round(((p.entryPrice - p.stopLoss) / p.entryPrice) * 100 * 10) / 10
        : null,
    })),
    portfolio_heat_pct: positions.reduce((sum, p) => {
      const riskPct = p.entryPrice && p.stopLoss && p.entryPrice > 0 && p.sizeUsd && port.total_usd
        ? ((p.entryPrice - p.stopLoss) / p.entryPrice) * (p.sizeUsd / (port.total_usd as number)) * 100
        : 0;
      return sum + riskPct;
    }, 0).toFixed(1),
  };

  // Compact market: only key fields
  const mkt = data.market as Record<string, unknown>;
  const compactMarket = {
    vix: mkt.vix,
    fear_greed: mkt.fear_greed,
    nasdaq_direction: mkt.nasdaq_direction,
  };

  const budgetSection = data.budget
    ? `\nBUDGET: slots=${JSON.stringify(
        Object.fromEntries(
          Object.entries(data.budget.segments).map(([seg, alloc]) => [seg, (alloc as any)?.slots ?? 0])
        )
      )} total_new=${data.budget.total_new_slots} swap=${data.budget.swap_allowed}\n`
    : '';

  const swapSection = data.swapCandidates && data.swapCandidates.length > 0
    ? `\nSWAP CANDIDATES (sell these to fund better setups — only if new_conf > entry_conv+20, held>=2d, pnl<+8%):\n${data.swapCandidates.map((s) => `${s.ticker}: held=${s.days_held}d pnl=${s.current_pnl_pct.toFixed(1)}% conv=${s.entry_conviction}`).join('\n')}\n`
    : '';

  const regimeSection = data.regime
    ? `REGIME: ${data.regime.regime} (conf=${data.regime.confidence}% sizing=${data.regime.sizing_multiplier} momentum=${data.regime.prefer_momentum})\n⚠️ BEARISH 4H in bull regime = PULLBACK ENTRY (type B/C, size 3-15%), NOT a skip!\n`
    : '';

  const heldSet = new Set(data.held_tickers);
  const buyCandidates = debates.filter(
    (d) => d.analyst_output.signal_15m === 'BUY' && !heldSet.has(d.ticker)
  ).sort((a, b) => b.analyst_output.confidence - a.analyst_output.confidence);

  const otherDebates = debates.filter(
    (d) => d.analyst_output.signal_15m !== 'BUY' || heldSet.has(d.ticker)
  );

  // Separate held debates for exit-signal analysis
  const heldDebates = debates.filter((d) => heldSet.has(d.ticker));
  const heldSection = heldDebates.length > 0
    ? `\n🔴 HELD POSITIONS (generate SELL if thesis invalid — rules 11-16):\n${heldDebates.map((d) => {
        const pos = positions.find((p) => p.ticker === d.ticker);
        const pnl = pos ? Math.round((pos.pnlPct ?? 0) * 10) / 10 : '?';
        const held = pos ? Math.round((pos.days_held ?? 0) * 10) / 10 : '?';
        return `${buildCompactDebateRow(d)} | pnl=${pnl}% held=${held}d`;
      }).join('\n')}\n`
    : '';

  const buySection = buyCandidates.length > 0
    ? `\n⚡ BUY CANDIDATES — generate proposals for these (${buyCandidates.length}):\n${buyCandidates.map(buildCompactDebateRow).join('\n')}\n`
    : '\n⚡ BUY CANDIDATES: none\n';

  const refSection = otherDebates.length > 0
    ? `\n📋 REFERENCE (NEUTRAL=low priority):\n${otherDebates.map(buildCompactDebateRow).join('\n')}\n`
    : '';

  return `Generate trade orders. Held: ${data.held_tickers.join(', ') || 'none'}
Portfolio: ${JSON.stringify(compactPortfolio)}
Market: ${JSON.stringify(compactMarket)}
${regimeSection}${budgetSection}${swapSection}${heldSection}${buySection}${refSection}
CRITICAL: Review HELD POSITIONS first. Apply exit rules 11-14. Only then allocate freed capital to BUY CANDIDATES.
Consider portfolio heat (${compactPortfolio.portfolio_heat_pct}% / 8% max). If >8%, SELL weakest before buying new.
Output JSON array only. Include SELL orders for invalid positions + BUY orders for best candidates. Empty [] only if truly nothing.`;
}
