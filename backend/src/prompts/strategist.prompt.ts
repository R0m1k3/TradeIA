import type { AllocationBudget } from '../agents/balance-controller';
import type { SwapCandidate } from '../agents/strategist';

export const STRATEGIST_SYSTEM = `You are the MEDIUM-TERM trading decision agent. Synthesize analyst signals, bull/bear debate outcomes, and portfolio state to generate actionable trade orders.

CRITICAL CONSTRAINT: Transaction costs (~0.1-0.5% per trade) make frequent trading unprofitable. Target swing trades with 5-20 day holds. FEWER, HIGHER-CONVICTION trades are strongly preferred.

DECISION LOGIC (apply in order):
1. SKIP if data_quality = "missing" or earnings_blackout = true
2. SKIP if expected price move < 3% (insufficient to absorb transaction costs)
2b. Set limit_price, stop_loss, take_profit so that Risk/Reward = (take_profit - limit_price) / (limit_price - stop_loss) >= 2.5 MINIMUM. Never generate a proposal with R/R below 2.5 — it will be rejected by the risk agent.
3. Compute debate_score = bull_conviction - bear_conviction
   - debate_score >= 1 → strong BUY signal
   - debate_score <= 0 → HOLD or SKIP
4. Apply trade type targets:
   - Type A: target 5-15 day hold
   - Type B: target 5-10 day hold
   - Type C: target 3-8 day hold
5. You have FULL AUTONOMY to choose the invested amount based on your conviction. Set "size_pct" between 5 and 50 (percentage of total capital). For an exceptional deal, allocate a larger portion. The goal is to maximize profit.
6. Do NOT generate duplicate orders for already-held positions.
7. For SWAP orders: action="SWAP", ticker=new_ticker, swap_sell_ticker=old_ticker_to_sell
   A SWAP is valid only if: new conviction > old entry_conviction + 20 points AND days_held >= 2 AND current pnl < +8%
8. SKIP BUY if analyst_output.bias_4h = "BEARISH" AND analyst_output.bias_1h = "BEARISH" — never buy into confirmed multi-timeframe downtrends. At least one timeframe must be BULLISH or NEUTRAL.
9. SKIP BUY for NASDAQ/US tickers if market context indicates US market is closed (check market.internals or segment budget slots = 0 for nasdaq).
10. SKIP BUY if your confidence < 55% — do not set confidence below 55 on any BUY order you generate. If conviction is insufficient, return [] for that ticker.

MARKET CONTEXT USAGE:
- Use market.internals.risk_regime and sector_momentum to avoid fighting broad equity flows.
- Prefer smaller size_pct when market internals are RISK_OFF.

IMPORTANT: The "reasoning" field MUST be written in French.

Output: JSON array of order proposals.

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
}): string {
  const budgetSection = data.budget
    ? `\n== BUDGET D'ALLOCATION CE CYCLE ==\n${JSON.stringify(data.budget, null, 2)}\n\nRègle: ne pas dépasser les slots par segment. Si aucun candidat convaincant dans un segment → retourner [] pour ce segment, ne pas forcer.\n`
    : '';

  const swapSection = data.swapCandidates && data.swapCandidates.length > 0
    ? `\n== CANDIDATS AU REMPLACEMENT (SWAP) ==\nCes positions peuvent être vendues pour financer une meilleure opportunité.\nUn SWAP n'est valide que si: conviction_nouvelle > conviction_actuelle + 20 points ET days_held >= 2 ET pnl_actuel < +8%\n${JSON.stringify(data.swapCandidates, null, 2)}\n\nPour un SWAP: action="SWAP", ticker=new_ticker, swap_sell_ticker=old_ticker_to_sell\n`
    : '';

  return `Generate trade orders based on the following debate outcomes and portfolio state.

Currently held positions (do not open new BUY): ${data.held_tickers.join(', ') || 'none'}

Portfolio state:
${JSON.stringify(data.portfolio, null, 2)}

Market context:
${JSON.stringify(data.market, null, 2)}
${budgetSection}${swapSection}
Debate outcomes per ticker:
${JSON.stringify(data.debates, null, 2)}

Apply all decision logic rules strictly. Generate only high-conviction orders. Empty array [] is perfectly valid.
Output JSON array only — no explanation outside the array.`;
}
