export const ANALYST_SYSTEM = `You are a MEDIUM-TERM technical analyst (swing trading, 5-20 day holds). You receive PRE-COMPUTED technical indicators and must interpret them to generate a trading signal.

CRITICAL: Transaction costs make short-term trading unprofitable. Every trade costs ~0.1-0.5% in commissions and slippage. You must target moves large enough to absorb these costs. Prefer FEWER, HIGHER-CONVICTION trades over frequent small trades.

DO NOT recalculate indicators — they are already computed for you.
Your job is to INTERPRET the patterns and generate a medium-term bias/signal.

ANALYSIS FRAMEWORK (prioritize longer timeframes):

4H/Daily Layer (Primary — swing bias):
- EMA 21/50/200 positioning → determine medium-term trend
- ADX strength (>25 = trending, <20 = ranging → skip or range-play only)
- MACD histogram direction → momentum confirmation over days
- Bias: BULLISH | BEARISH | NEUTRAL

1H Layer (Tactical timing):
- RSI level and divergence signals
- MACD cross signal direction
- Key support/resistance levels proximity
- Used for ENTRY TIMING only, not for trade direction

15min Layer (Precision entry — optional):
- Use only to fine-tune entry within a medium-term thesis
- RSI overbought/oversold for pullback entries
- Volume ratio (>1.5 = unusual activity)

TRADE CLASSIFICATION (medium-term):
- Type A: Medium-term trend-following, 2% portfolio risk, requires 4H trend + 1H alignment, target 5-15 day hold
- Type B: Swing reversal, 1.5% risk, requires strong divergence + S/R break, target 5-10 day hold
- Type C: Range-bound with wide targets, 1% risk, requires clear S/R levels, target 3-8 day hold

STOP & TARGET (medium-term — wide to survive noise):
- Stop: 3.0 × ATR(14) from entry (wider stop = less noise stop-out)
- Target: 6.0 × ATR(14) from entry minimum (minimum R/R = 2.0, prefer 3.0+)
- Only enter if expected move > 3% to cover transaction costs

CONVICTION THRESHOLDS (be selective):
- Confidence < 65 → skip (not enough edge to justify transaction cost)
- Confidence 65-75 → trade only with strong 4H trend alignment
- Confidence > 75 → full position allowed

IMPORTANT: All text fields (candle_pattern, skip_reason, etc.) MUST be written in French.

Output STRICT JSON only:
{
  "analyses": [
    {
      "ticker": "",
      "bias_4h": "BULLISH|BEARISH|NEUTRAL",
      "bias_1h": "BULLISH|BEARISH|NEUTRAL",
      "signal_15m": "BUY|SELL|NEUTRAL",
      "trade_type": "A|B|C",
      "entry_price": 0,
      "stop_loss": 0,
      "take_profit": 0,
      "atr": 0,
      "rsi_15m": 0,
      "rsi_1h": 0,
      "macd_signal": "bullish|bearish|neutral",
      "volume_ratio": 0,
      "key_levels": { "support": [], "resistance": [] },
      "candle_pattern": "",
      "confidence": 0,
      "skip_reason": null,
      "expected_hold_days": 0
    }
  ]
}`;

export function buildAnalystPrompt(data: {
  ticker: string;
  current_price: number;
  indicators: {
    rsi_14: number | null;
    rsi_1h: number | null;
    macd_signal: string;
    macd_histogram: number | null;
    ema_9: number | null;
    ema_21: number | null;
    ema_50: number | null;
    ema_200: number | null;
    atr_14: number | null;
    adx: number | null;
    bb_upper: number | null;
    bb_middle: number | null;
    bb_lower: number | null;
    volume_ratio: number | null;
    support_levels: number[];
    resistance_levels: number[];
  };
  fundamentals?: unknown;
  news?: unknown[];
  sentiment?: unknown;
  tweets?: unknown[];
}): string {
  return `Analyze ${data.ticker} using the PRE-COMPUTED indicators below.

Current price: $${data.current_price}

TECHNICAL INDICATORS (already computed — interpret, do not recalculate):
- RSI(14) 15min: ${data.indicators.rsi_14 ?? 'N/A'}
- RSI(14) 1hour: ${data.indicators.rsi_1h ?? 'N/A'}
- MACD signal: ${data.indicators.macd_signal} (histogram: ${data.indicators.macd_histogram ?? 'N/A'})
- EMA 9: ${data.indicators.ema_9?.toFixed(2) ?? 'N/A'}
- EMA 21: ${data.indicators.ema_21?.toFixed(2) ?? 'N/A'}
- EMA 50: ${data.indicators.ema_50?.toFixed(2) ?? 'N/A'}
- EMA 200: ${data.indicators.ema_200?.toFixed(2) ?? 'N/A'}
- ATR(14): ${data.indicators.atr_14?.toFixed(2) ?? 'N/A'}
- ADX: ${data.indicators.adx?.toFixed(1) ?? 'N/A'}
- Bollinger: Upper=${data.indicators.bb_upper?.toFixed(2) ?? 'N/A'} Mid=${data.indicators.bb_middle?.toFixed(2) ?? 'N/A'} Lower=${data.indicators.bb_lower?.toFixed(2) ?? 'N/A'}
- Volume ratio: ${data.indicators.volume_ratio?.toFixed(2) ?? 'N/A'}x average
- Support levels: [${data.indicators.support_levels.map((l) => l.toFixed(2)).join(', ')}]
- Resistance levels: [${data.indicators.resistance_levels.map((l) => l.toFixed(2)).join(', ')}]

FUNDAMENTALS: ${data.fundamentals ? JSON.stringify(data.fundamentals) : 'N/A'}

RECENT NEWS: ${data.news ? JSON.stringify(data.news) : 'N/A'}

SENTIMENT: ${data.sentiment ? JSON.stringify(data.sentiment) : 'N/A'}

TWITTER/X SIGNALS: ${data.tweets && data.tweets.length > 0 ? data.tweets.map((t: any) => `[${t.sentiment_hint}] @${t.author}: ${t.text}`).join('\n') : 'N/A'}

Based on these indicators, generate your analysis. Use ATR for stop/target calculations.
If indicators are insufficient (many nulls), set skip_reason and confidence=0.
Output JSON only.`;
}