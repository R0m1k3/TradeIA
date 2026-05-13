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

export function buildStrategistPrompt(data: {
  debates: unknown[];
  portfolio: unknown;
  market: unknown;
  held_tickers: string[];
  budget?: AllocationBudget;
  swapCandidates?: SwapCandidate[];
  regime?: RegimeAssessment;
}): string {
  const budgetSection = data.budget
    ? `\n== BUDGET D'ALLOCATION CE CYCLE ==\n${JSON.stringify(data.budget, null, 2)}\n\nRègle: ne pas dépasser les slots par segment. Si aucun candidat convaincant dans un segment → retourner [] pour ce segment, ne pas forcer.\n`
    : '';

  const swapSection = data.swapCandidates && data.swapCandidates.length > 0
    ? `\n== CANDIDATS AU REMPLACEMENT (SWAP) ==\nCes positions peuvent être vendues pour financer une meilleure opportunité.\nUn SWAP n'est valide que si: conviction_nouvelle > conviction_actuelle + 20 points ET days_held >= 2 ET pnl_actuel < +8%\n${JSON.stringify(data.swapCandidates, null, 2)}\n\nPour un SWAP: action="SWAP", ticker=new_ticker, swap_sell_ticker=old_ticker_to_sell\n`
    : '';

  const regimeSection = data.regime
    ? `\n== RÉGIME DE MARCHÉ ACTUEL ==\nRegime: ${data.regime.regime}\nConfiance régime: ${data.regime.confidence}%\nSizing multiplier: ${data.regime.sizing_multiplier}\nPréfère momentum: ${data.regime.prefer_momentum}\nRaison: ${data.regime.reason}\n\n⚠️ RAPPEL RÈGLE 8: Si regime= bull_trend/bull_range et bias_4h=BEARISH → c'est une OPPORTUNITÉ (pullback/mean-reversion), PAS un skip!\n`
    : '';

  return `Generate trade orders based on the following debate outcomes and portfolio state.

Currently held positions (do not open new BUY): ${data.held_tickers.join(', ') || 'none'}

Portfolio state:
${JSON.stringify(data.portfolio, null, 2)}

Market context:
${JSON.stringify(data.market, null, 2)}
${regimeSection}${budgetSection}${swapSection}
Debate outcomes per ticker:
${JSON.stringify(data.debates, null, 2)}

Apply all decision logic rules strictly. Generate proposals for any setup meeting the relaxed thresholds. Empty array [] only if truly nothing qualifies.
Output JSON array only — no explanation outside the array.`;
}
