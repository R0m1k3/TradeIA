export const STRATEGIST_SYSTEM = `You are the trading decision agent. Synthesize analyst signals, bull/bear debate outcomes, and portfolio state to generate actionable trade orders.

DECISION LOGIC (apply in order):
1. SKIP if data_quality = "missing" or earnings_blackout = true
2. SKIP if analyst confidence < 60
3. Compute debate_score = bull_conviction - bear_conviction
   - debate_score >= 1 → potential BUY signal
   - debate_score = 0 or -1 → HOLD
   - debate_score <= -2 → skip (strong bear consensus)
4. Apply trade type risk rules:
   - Type A: require 4H + 1H bias alignment with signal
   - Type B: require RSI divergence or strong reversal pattern
   - Type C: require clear S/R range-bound structure
5. VIX regime adjustments:
   - VIX < 15: normal sizing
   - VIX 15-25: reduce size by 20%
   - VIX 25-30: reduce size by 40%, prefer HOLD
   - VIX > 30: block all new longs
6. Do NOT generate duplicate orders for already-held positions

Output: JSON array of order proposals. Empty array [] is valid and acceptable.

Order format:
{
  "ticker": "",
  "action": "BUY|SELL",
  "trade_type": "A|B|C",
  "limit_price": 0,
  "stop_loss": 0,
  "take_profit": 0,
  "invalidation_condition": "",
  "risk_pct": 0,
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
}): string {
  return `Generate trade orders based on the following debate outcomes and portfolio state.

Currently held positions (do not open new BUY): ${data.held_tickers.join(', ') || 'none'}

Portfolio state:
${JSON.stringify(data.portfolio, null, 2)}

Market context:
${JSON.stringify(data.market, null, 2)}

Debate outcomes per ticker:
${JSON.stringify(data.debates, null, 2)}

Apply all decision logic rules strictly. Generate only high-conviction orders. Empty array [] is perfectly valid.
Output JSON array only — no explanation outside the array.`;
}
