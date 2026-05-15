import { prisma } from '../lib/prisma';

export interface TickerCalibration {
  /** -10 to +10 confidence adjustment based on historical resolved win rate */
  confidence_delta: number;
  win_rate: number;
  sample_size: number;
}

/**
 * Compute confidence calibration per ticker from resolved AgentPredictions.
 *
 * Logic:
 *  - Need ≥ 5 resolved predictions per ticker to be statistically meaningful.
 *  - Baseline win rate is 0.50 (coin flip).
 *  - For win_rate >= 0.65 → +10 confidence
 *  - For win_rate >= 0.55 → +5 confidence
 *  - For win_rate <= 0.35 → -10 confidence
 *  - For win_rate <= 0.45 → -5 confidence
 *  - Otherwise 0.
 *
 * This is the minimal feedback loop: the system gets less confident on tickers
 * where bull/bear debates have historically misjudged direction.
 */
export async function getTickerCalibrations(tickers: string[]): Promise<Record<string, TickerCalibration>> {
  if (tickers.length === 0) return {};

  try {
    const predictions = await (prisma as any).agentPrediction.findMany({
      where: {
        ticker: { in: tickers },
        resolvedAt: { not: null },
        correct: { not: null },
      },
      select: { ticker: true, correct: true },
    });

    const grouped: Record<string, { wins: number; total: number }> = {};
    for (const p of predictions) {
      if (!grouped[p.ticker]) grouped[p.ticker] = { wins: 0, total: 0 };
      grouped[p.ticker].total += 1;
      if (p.correct) grouped[p.ticker].wins += 1;
    }

    const calibrations: Record<string, TickerCalibration> = {};
    for (const [ticker, { wins, total }] of Object.entries(grouped)) {
      if (total < 5) continue;
      const wr = wins / total;
      let delta = 0;
      if (wr >= 0.65) delta = 10;
      else if (wr >= 0.55) delta = 5;
      else if (wr <= 0.35) delta = -10;
      else if (wr <= 0.45) delta = -5;
      calibrations[ticker] = { confidence_delta: delta, win_rate: wr, sample_size: total };
    }

    return calibrations;
  } catch (err) {
    console.warn('[Calibration] Failed to load AgentPredictions:', (err as Error).message);
    return {};
  }
}
