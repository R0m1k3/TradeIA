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

  // Compact portfolio: only fields strategist needs
  const port = data.portfolio as Record<string, unknown>;
  const compactPortfolio = {
    cash_usd: port.cash_usd,
    total_usd: port.total_usd,
    daily_pnl_pct: port.daily_pnl_pct,
    risk_regime: port.risk_regime,
    positions_count: Array.isArray(port.positions) ? port.positions.length : 0,
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

  const debateRows = debates.map(buildCompactDebateRow).join('\n');

  return `Generate trade orders. Held (skip BUY): ${data.held_tickers.join(', ') || 'none'}
Portfolio: ${JSON.stringify(compactPortfolio)}
Market: ${JSON.stringify(compactMarket)}
${regimeSection}${budgetSection}${swapSection}
DEBATES (${debates.length} tickers — format: ticker | signal/4h/1h | conf | score(Bull/bear) | price sl tp rr | rsi vol pattern type | BULL case | BEAR case):
${debateRows}

Output JSON array only. Generate ≥1 proposal if any setup qualifies. Empty [] only if truly nothing.`;
}
