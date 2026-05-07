import { getYahooOHLCV } from '../data/yahoo';

/**
 * Market regime classifier.
 *
 * The same setup performs very differently depending on the broader market state:
 *   - In a strong bull trend, momentum strategies (breakouts, trend-following) print money.
 *   - In a choppy range, mean-reversion (RSI extremes, BB rebound) wins; momentum loses.
 *   - In a volatile bear, both fail; cash is the right move.
 *
 * Inputs combine VIX (volatility), QQQ trend (direction + strength), and breadth.
 */
export type MarketRegime =
  | 'bull_trend'
  | 'bull_range'
  | 'bear_trend'
  | 'bear_range'
  | 'transition'; // VIX spike or trend break — pause new entries

export interface RegimeAssessment {
  regime: MarketRegime;
  confidence: number;       // 0–100
  reason: string;
  /** Sizing multiplier to apply on top of base position size (Kelly etc.) */
  sizing_multiplier: number;
  /** Should the system favor momentum (true) or mean-reversion (false)? */
  prefer_momentum: boolean;
  /** Inputs used, for logging */
  inputs: {
    vix: number;
    qqq_change_5d_pct: number | null;
    qqq_adx: number | null;
  };
}

/** Compute ADX-like trend strength (simplified) from daily QQQ closes */
function computeTrendStrength(closes: number[]): number | null {
  if (closes.length < 14) return null;
  const recent = closes.slice(-14);
  // Linear regression slope normalized by std dev (poor man's ADX)
  const n = recent.length;
  const xMean = (n - 1) / 2;
  const yMean = recent.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let xVar = 0;
  let yVar = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (recent[i] - yMean);
    xVar += (i - xMean) ** 2;
    yVar += (recent[i] - yMean) ** 2;
  }
  if (xVar === 0 || yVar === 0) return 0;
  const r2 = (num * num) / (xVar * yVar); // [0,1] — 1 = perfect linear trend
  return Math.round(r2 * 100); // 0–100, ADX-like
}

export async function classifyRegime(vix: number): Promise<RegimeAssessment> {
  let qqq5dChange: number | null = null;
  let qqqAdx: number | null = null;

  try {
    const bars = await getYahooOHLCV('QQQ', '1d', '1mo');
    if (bars.length >= 6) {
      const closes = bars.map((b) => b.close);
      const last = closes[closes.length - 1];
      const fiveAgo = closes[closes.length - 6];
      qqq5dChange = ((last - fiveAgo) / fiveAgo) * 100;
      qqqAdx = computeTrendStrength(closes);
    }
  } catch {
    // QQQ unavailable — fall back to VIX-only
  }

  const inputs = { vix, qqq_change_5d_pct: qqq5dChange, qqq_adx: qqqAdx };

  // Volatility shock — pause new entries
  if (vix > 35) {
    return {
      regime: 'transition',
      confidence: 90,
      reason: `VIX ${vix.toFixed(1)} > 35 — vol shock`,
      sizing_multiplier: 0.0,
      prefer_momentum: false,
      inputs,
    };
  }

  if (vix > 28) {
    return {
      regime: 'transition',
      confidence: 70,
      reason: `VIX ${vix.toFixed(1)} > 28 — elevated volatility`,
      sizing_multiplier: 0.4,
      prefer_momentum: false,
      inputs,
    };
  }

  // No QQQ data — default to range with VIX-based sizing
  if (qqq5dChange === null || qqqAdx === null) {
    const sizing = vix < 18 ? 0.9 : 0.7;
    return {
      regime: 'bull_range',
      confidence: 40,
      reason: `QQQ data unavailable; VIX ${vix.toFixed(1)} → defaulting to range`,
      sizing_multiplier: sizing,
      prefer_momentum: false,
      inputs,
    };
  }

  const trending = qqqAdx >= 60; // strong R² → directional move
  const direction = qqq5dChange > 0 ? 'bull' : 'bear';

  // Bull trend — best regime for momentum strategies
  if (direction === 'bull' && trending && qqq5dChange > 1.0) {
    return {
      regime: 'bull_trend',
      confidence: 85,
      reason: `QQQ +${qqq5dChange.toFixed(1)}% over 5d, trend score ${qqqAdx}`,
      sizing_multiplier: 1.1, // mild boost — trend market favors larger sizes
      prefer_momentum: true,
      inputs,
    };
  }

  // Bear trend — short bias only; we don't short, so reduce drastically
  if (direction === 'bear' && trending && qqq5dChange < -1.0) {
    return {
      regime: 'bear_trend',
      confidence: 80,
      reason: `QQQ ${qqq5dChange.toFixed(1)}% over 5d, trend score ${qqqAdx} — bearish`,
      sizing_multiplier: 0.3,
      prefer_momentum: false,
      inputs,
    };
  }

  // Range markets — mean-reversion friendly, momentum fails
  if (direction === 'bull') {
    return {
      regime: 'bull_range',
      confidence: 65,
      reason: `Bull bias (+${qqq5dChange.toFixed(1)}%) but choppy (trend score ${qqqAdx})`,
      sizing_multiplier: 0.85,
      prefer_momentum: false,
      inputs,
    };
  }

  return {
    regime: 'bear_range',
    confidence: 65,
    reason: `Bearish (${qqq5dChange.toFixed(1)}%) and choppy (trend score ${qqqAdx})`,
    sizing_multiplier: 0.5,
    prefer_momentum: false,
    inputs,
  };
}
