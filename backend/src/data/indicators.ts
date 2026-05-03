import {
  RSI, MACD, EMA, ATR, ADX, BollingerBands, SMA,
} from 'technicalindicators';

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  rsi_14: number | null;
  rsi_1h: number | null;
  macd_signal: 'bullish' | 'bearish' | 'neutral';
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
  bb_width: number | null;
  bb_width_regime: 'narrow' | 'normal' | 'wide' | null;
  volume_ratio: number | null;
  support_levels: number[];
  resistance_levels: number[];
  roc_10: number | null;
  rsi_divergence: 'bullish' | 'bearish' | 'none' | null;
}

export function computeIndicators(bars_15m: OHLCVBar[], bars_1h: OHLCVBar[], bars_4h: OHLCVBar[]): IndicatorValues {
  const ind_15m = bars_15m.length > 20 ? computeFromBars(bars_15m) : emptyFrame();
  const ind_1h = bars_1h.length > 20 ? computeFromBars(bars_1h) : emptyFrame();
  const ind_4h = bars_4h.length > 20 ? computeFromBars(bars_4h) : emptyFrame();

  const levels = computeSRLevels(bars_4h);

  return {
    rsi_14: ind_15m.rsi,
    rsi_1h: ind_1h.rsi,
    macd_signal: ind_1h.macd_signal,
    macd_histogram: ind_1h.macd_histogram,
    ema_9: ind_4h.ema_9,
    ema_21: ind_4h.ema_21,
    ema_50: ind_4h.ema_50,
    ema_200: ind_4h.ema_200,
    atr_14: ind_4h.atr,
    adx: ind_4h.adx,
    bb_upper: ind_4h.bb_upper,
    bb_middle: ind_4h.bb_middle,
    bb_lower: ind_4h.bb_lower,
    bb_width: ind_4h.bb_width,
    bb_width_regime: ind_4h.bb_width_regime,
    volume_ratio: ind_15m.volume_ratio,
    support_levels: levels.support,
    resistance_levels: levels.resistance,
    roc_10: ind_4h.roc_10,
    rsi_divergence: detectRSIDivergence(bars_4h, ind_4h.rsi_series),
  };
}

interface FrameIndicators {
  rsi: number | null;
  rsi_series: number[];
  macd_signal: 'bullish' | 'bearish' | 'neutral';
  macd_histogram: number | null;
  ema_9: number | null;
  ema_21: number | null;
  ema_50: number | null;
  ema_200: number | null;
  atr: number | null;
  adx: number | null;
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  bb_width: number | null;
  bb_width_regime: 'narrow' | 'normal' | 'wide' | null;
  volume_ratio: number | null;
  roc_10: number | null;
}

function computeFromBars(bars: OHLCVBar[]): FrameIndicators {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  // RSI(14) — returns number[]
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const rsi = last(rsiArr);

  // MACD — returns { MACD: number, signal: number, histogram: number }[]
  const macdArr = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const lastMacd = last(macdArr);
  const macd_signal: 'bullish' | 'bearish' | 'neutral' =
    lastMacd && lastMacd.MACD != null && lastMacd.signal != null
      ? lastMacd.MACD > lastMacd.signal
        ? 'bullish'
        : lastMacd.MACD < lastMacd.signal
          ? 'bearish'
          : 'neutral'
      : 'neutral';
  const macd_histogram = lastMacd?.histogram ?? null;

  // EMAs — return number[]
  const ema_9 = last(EMA.calculate({ values: closes, period: 9 }));
  const ema_21 = last(EMA.calculate({ values: closes, period: 21 }));
  const ema_50 = last(EMA.calculate({ values: closes, period: 50 }));
  const ema_200 = closes.length >= 200 ? last(EMA.calculate({ values: closes, period: 200 })) : null;

  // ATR(14) — returns number[]
  const atrArr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = last(atrArr);

  // ADX(14) — returns { adx: number, pdi: number, mdi: number }[]
  const adxArr = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const adx = last(adxArr)?.adx ?? null;

  // Bollinger Bands — returns { upper: number, middle: number, lower: number }[]
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const lastBB = last(bbArr);

  // BB Width regime: narrow = range, wide = trend
  let bb_width: number | null = null;
  let bb_width_regime: 'narrow' | 'normal' | 'wide' | null = null;
  if (lastBB && lastBB.middle > 0) {
    bb_width = (lastBB.upper - lastBB.lower) / lastBB.middle;
    // Compare to historical BB widths
    const recentWidths = bbArr.slice(-20).map((b) => b.middle > 0 ? (b.upper - b.lower) / b.middle : 0).filter((w) => w > 0);
    if (recentWidths.length >= 10) {
      const avgWidth = recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length;
      if (bb_width < avgWidth * 0.7) bb_width_regime = 'narrow';
      else if (bb_width > avgWidth * 1.3) bb_width_regime = 'wide';
      else bb_width_regime = 'normal';
    }
  }

  // ROC (Rate of Change) 10 periods — momentum score
  let roc_10: number | null = null;
  if (closes.length > 10) {
    const pastClose = closes[closes.length - 11];
    if (pastClose > 0) {
      roc_10 = ((closes[closes.length - 1] - pastClose) / pastClose) * 100;
    }
  }

  // Volume ratio
  const volAvg = volumes.length > 20
    ? volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
    : null;
  const volume_ratio = volAvg && volAvg > 0
    ? (volumes[volumes.length - 1] ?? 0) / volAvg
    : null;

  return {
    rsi,
    rsi_series: rsiArr.map((v) => v),
    macd_signal,
    macd_histogram,
    ema_9,
    ema_21,
    ema_50,
    ema_200,
    atr,
    adx,
    bb_upper: lastBB?.upper ?? null,
    bb_middle: lastBB?.middle ?? null,
    bb_lower: lastBB?.lower ?? null,
    bb_width,
    bb_width_regime,
    volume_ratio,
    roc_10,
  };
}

function last<T>(arr: T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined;
}

function emptyFrame(): FrameIndicators {
  return {
    rsi: null,
    rsi_series: [],
    macd_signal: 'neutral',
    macd_histogram: null,
    ema_9: null,
    ema_21: null,
    ema_50: null,
    ema_200: null,
    atr: null,
    adx: null,
    bb_upper: null,
    bb_middle: null,
    bb_lower: null,
    bb_width: null,
    bb_width_regime: null,
    volume_ratio: null,
    roc_10: null,
  };
}

function computeSRLevels(bars: OHLCVBar[]): { support: number[]; resistance: number[] } {
  if (bars.length < 10) return { support: [], resistance: [] };

  const recent = bars.slice(-50);
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (
      recent[i].high > recent[i - 1].high &&
      recent[i].high > recent[i - 2].high &&
      recent[i].high > recent[i + 1].high &&
      recent[i].high > recent[i + 2].high
    ) {
      pivotHighs.push(recent[i].high);
    }
    if (
      recent[i].low < recent[i - 1].low &&
      recent[i].low < recent[i - 2].low &&
      recent[i].low < recent[i + 1].low &&
      recent[i].low < recent[i + 2].low
    ) {
      pivotLows.push(recent[i].low);
    }
  }

  const currentPrice = bars[bars.length - 1].close;
  const support = pivotLows.filter((l) => l < currentPrice).sort((a, b) => b - a).slice(0, 3);
  const resistance = pivotHighs.filter((h) => h > currentPrice).sort((a, b) => a - b).slice(0, 3);

  return { support, resistance };
}

export function compute4HBias(indicators: IndicatorValues): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const { ema_9, ema_21, ema_50, adx } = indicators;

  if (!ema_9 || !ema_21 || !ema_50) return 'NEUTRAL';

  const bullishAlignment = ema_9 > ema_21 && ema_21 > ema_50;
  const bearishAlignment = ema_9 < ema_21 && ema_21 < ema_50;
  const trending = adx !== null && adx > 25;

  if (bullishAlignment && trending) return 'BULLISH';
  if (bearishAlignment && trending) return 'BEARISH';
  if (bullishAlignment) return 'BULLISH';
  if (bearishAlignment) return 'BEARISH';
  return 'NEUTRAL';
}

export function compute15mSignal(indicators: IndicatorValues): 'BUY' | 'SELL' | 'NEUTRAL' {
  const { rsi_14, macd_signal, volume_ratio, adx, bb_lower, bb_upper, rsi_divergence, support_levels, resistance_levels } = indicators;

  if (rsi_14 === null || macd_signal === 'neutral') return 'NEUTRAL';

  const highVolume = volume_ratio !== null && volume_ratio > 1.5;

  // RSI divergence overrides — strongest signal
  if (rsi_divergence === 'bullish' && rsi_14 < 40) return 'BUY';
  if (rsi_divergence === 'bearish' && rsi_14 > 60) return 'SELL';

  // Type C: Mean-reversion logic (ADX < 20 = ranging market)
  // In ranges: buy oversold at support, sell overbought at resistance
  const isRanging = adx !== null && adx < 20;
  if (isRanging) {
    // Buy when oversold near lower BB (support zone in range)
    if (rsi_14 < 30 && macd_signal !== 'bearish') return 'BUY';
    // Sell when overbought near upper BB (resistance zone in range)
    if (rsi_14 > 70 && macd_signal !== 'bullish') return 'SELL';
    // Moderate mean-reversion signals
    if (rsi_14 < 35) return 'BUY';
    if (rsi_14 > 65) return 'SELL';
    return 'NEUTRAL';
  }

  // Type A/B: Momentum logic (trending market)
  if (rsi_14 < 30 && macd_signal === 'bullish' && highVolume) return 'BUY';
  if (rsi_14 > 70 && macd_signal === 'bearish' && highVolume) return 'SELL';
  if (rsi_14 < 35 && macd_signal === 'bullish') return 'BUY';
  if (rsi_14 > 65 && macd_signal === 'bearish') return 'SELL';

  return 'NEUTRAL';
}

/** Detect RSI divergence: bearish (price HH + RSI LH) or bullish (price LL + RSI HL) */
function detectRSIDivergence(bars: OHLCVBar[], rsiSeries: number[]): 'bullish' | 'bearish' | 'none' | null {
  if (bars.length < 20 || rsiSeries.length < 20) return null;

  const recent = bars.slice(-20);
  const recentRSI = rsiSeries.slice(-20);
  if (recentRSI.some((v) => v === null || v === undefined)) return null;

  // Find local price highs and lows (simple pivot detection)
  const pivotHighs: { price: number; rsi: number; idx: number }[] = [];
  const pivotLows: { price: number; rsi: number; idx: number }[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
        recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
      pivotHighs.push({ price: recent[i].high, rsi: recentRSI[i], idx: i });
    }
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
        recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
      pivotLows.push({ price: recent[i].low, rsi: recentRSI[i], idx: i });
    }
  }

  // Bearish divergence: price higher high + RSI lower high
  if (pivotHighs.length >= 2) {
    const last = pivotHighs[pivotHighs.length - 1];
    const prev = pivotHighs[pivotHighs.length - 2];
    if (last.price > prev.price && last.rsi < prev.rsi && last.rsi > 50) {
      return 'bearish';
    }
  }

  // Bullish divergence: price lower low + RSI higher low
  if (pivotLows.length >= 2) {
    const last = pivotLows[pivotLows.length - 1];
    const prev = pivotLows[pivotLows.length - 2];
    if (last.price < prev.price && last.rsi > prev.rsi && last.rsi < 50) {
      return 'bullish';
    }
  }

  return 'none';
}

export function computeTradeType(indicators: IndicatorValues): 'A' | 'B' | 'C' {
  const { adx, bb_width_regime } = indicators;
  // Trending: ADX > 25 OR wide BB
  if ((adx !== null && adx > 25) || bb_width_regime === 'wide') return 'A';
  // Ranging: ADX < 20 AND narrow BB
  if (adx !== null && adx < 20) return 'C';
  if (bb_width_regime === 'narrow') return 'C';
  return 'B';
}

export function computeLevels(
  currentPrice: number,
  atr: number | null,
  signal: 'BUY' | 'SELL' | 'NEUTRAL'
): { entry: number; stop_loss: number; take_profit: number } {
  const atrValue = atr || currentPrice * 0.01;

  if (signal === 'BUY') {
    return {
      entry: currentPrice,
      stop_loss: currentPrice - 1.5 * atrValue,
      take_profit: currentPrice + 3 * atrValue,
    };
  }
  if (signal === 'SELL') {
    return {
      entry: currentPrice,
      stop_loss: currentPrice + 1.5 * atrValue,
      take_profit: currentPrice - 3 * atrValue,
    };
  }
  return {
    entry: currentPrice,
    stop_loss: currentPrice - 1.5 * atrValue,
    take_profit: currentPrice + 3 * atrValue,
  };
}