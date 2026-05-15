import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildAnalystPrompt, ANALYST_SYSTEM } from '../prompts/analyst.prompt';
import { compute4HBias, compute15mSignal, computeTradeType, computeLevels, type IndicatorValues } from '../data/indicators';
import { getTickerCalibrations, type TickerCalibration } from '../data/prediction-calibration';
import type { CollectorOutput } from './collector';

function applyCalibration(
  confidence: number,
  calibration: TickerCalibration | undefined,
  ticker: string
): { confidence: number; note: string | null } {
  if (!calibration) return { confidence, note: null };
  const adjusted = Math.max(0, Math.min(95, confidence + calibration.confidence_delta));
  const note = `calibration ${ticker}: ${calibration.win_rate.toFixed(2)} WR sur ${calibration.sample_size} préd. → ${calibration.confidence_delta >= 0 ? '+' : ''}${calibration.confidence_delta}`;
  if (calibration.confidence_delta !== 0) console.log(`[Analyst] ${note}`);
  return { confidence: adjusted, note };
}

export interface AnalystOutput {
  ticker: string;
  bias_4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bias_1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  signal_15m: 'BUY' | 'SELL' | 'NEUTRAL';
  trade_type: 'A' | 'B' | 'C';
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
  skip_reason: string | null;
  data_quality?: string;
  data_freshness_score?: number;
}

export class AnalystAgent {
  async run(collectorOutput: CollectorOutput): Promise<AnalystOutput[]> {
    console.log('[Analyst] Starting multi-timeframe analysis');
    const results: AnalystOutput[] = [];
    const MODELS = await getModels();
    const maxLlmAnalyses = Math.max(0, parseInt(process.env.ANALYST_LLM_MAX_PER_CYCLE || '3', 10));
    const minLlmConfidence = Math.max(0, parseInt(process.env.ANALYST_LLM_MIN_CONFIDENCE || '45', 10));
    let llmAnalysesUsed = 0;

    // Sequential counter: pre-check LLM budget under lock to avoid race in Promise.all
    const tryClaimLlmSlot = (): boolean => {
      if (llmAnalysesUsed >= maxLlmAnalyses) return false;
      llmAnalysesUsed++;
      return true;
    };

    const tickers = Object.keys(collectorOutput.tickers);
    const calibrations = await getTickerCalibrations(tickers);
    const calibratedCount = Object.keys(calibrations).length;
    if (calibratedCount > 0) {
      console.log(`[Analyst] Calibrations chargées pour ${calibratedCount}/${tickers.length} tickers`);
    }

    await Promise.all(
      Object.entries(collectorOutput.tickers).map(async ([ticker, data]) => {
        if (data.data_quality === 'missing') {
          console.log(`[Analyst] Skipping ${ticker} — missing data`);
          return;
        }
        const indicators: IndicatorValues | null = (data as any).indicators ?? null;

        // Deterministic fallback when no LLM available or indicators are pre-computed
        if (indicators) {
          const deterministic = this.deterministicAnalysis(ticker, data.current_price, indicators);
          const shouldUseLlm =
            maxLlmAnalyses > 0 &&
            deterministic.confidence >= minLlmConfidence &&
            tryClaimLlmSlot();

          if (!shouldUseLlm) {
            const rawConfidence = data.data_freshness.score < 60 ? Math.min(deterministic.confidence, 55) : deterministic.confidence;
            const calibrated = applyCalibration(rawConfidence, calibrations[ticker], ticker);
            results.push({
              ...deterministic,
              data_quality: data.data_quality,
              data_freshness_score: data.data_freshness.score,
              confidence: calibrated.confidence,
              skip_reason: data.data_freshness.score < 40 ? 'Données trop anciennes ou incomplètes' : deterministic.skip_reason,
            });
            return;
          }

          // Try LLM for qualitative interpretation, fall back to deterministic
          try {
            const prompt = buildAnalystPrompt({
              ticker,
              current_price: data.current_price,
              indicators,
              tradingview: data.tradingview,
              market_context: collectorOutput.market,
              data_freshness: data.data_freshness,
              fundamentals: data.fundamentals,
              news: data.news,
              rss_news: data.news,
            });

            const response = await callLLM('analyst', MODELS.MID, ANALYST_SYSTEM, prompt, 900);
            const parsed = parseJsonResponse<{ analyses: AnalystOutput[] }>(response.content);

            if (parsed.analyses && parsed.analyses.length > 0) {
              // Validate LLM output against deterministic values
              for (const analysis of parsed.analyses) {
                // Sanitize all LLM string outputs — LLMs often add trailing whitespace
                analysis.bias_4h = (analysis.bias_4h || 'NEUTRAL').trim() as AnalystOutput['bias_4h'];
                analysis.bias_1h = (analysis.bias_1h || 'NEUTRAL').trim() as AnalystOutput['bias_1h'];
                analysis.signal_15m = (analysis.signal_15m || 'NEUTRAL').trim() as AnalystOutput['signal_15m'];
                analysis.trade_type = (analysis.trade_type || 'C').trim() as AnalystOutput['trade_type'];
                analysis.macd_signal = (analysis.macd_signal || 'neutral').trim();
                analysis.candle_pattern = (analysis.candle_pattern || 'aucun').trim();
                // LLM sets volume_ratio=0 when data is missing — treat as neutral (1.0) not zero volume
                if (!analysis.volume_ratio || analysis.volume_ratio <= 0) analysis.volume_ratio = 1.0;
                analysis.data_quality = data.data_quality;
                analysis.data_freshness_score = data.data_freshness.score;
                if (data.data_freshness.score < 60) {
                  // Cap confidence but don't block — Yahoo Finance (delayed) scores ~17-70
                  // depending on secondary sources; low score ≠ bad OHLCV data
                  analysis.confidence = Math.min(analysis.confidence, 55);
                }
                if (data.data_freshness.score < 40) {
                  // Truly stale/missing data — mark for soft skip
                  analysis.skip_reason = analysis.skip_reason || 'Données trop anciennes ou incomplètes';
                }
                // Calibration historique AgentPrediction
                const calibrated = applyCalibration(analysis.confidence, calibrations[ticker], ticker);
                analysis.confidence = calibrated.confidence;
                if (analysis.confidence <= 0) {
                  analysis.skip_reason = analysis.skip_reason || 'LLM low confidence';
                }
                results.push(analysis);
              }
              return;
            }
          } catch (err) {
            console.warn(`[Analyst] LLM failed for ${ticker}, using deterministic:`, (err as Error).message);
          }

          // Deterministic fallback
          const rawConfidenceFallback = data.data_freshness.score < 60 ? Math.min(deterministic.confidence, 55) : deterministic.confidence;
          const calibratedFallback = applyCalibration(rawConfidenceFallback, calibrations[ticker], ticker);
          results.push({
            ...deterministic,
            data_quality: data.data_quality,
            data_freshness_score: data.data_freshness.score,
            confidence: calibratedFallback.confidence,
            skip_reason: data.data_freshness.score < 40 ? 'Données trop anciennes ou incomplètes' : deterministic.skip_reason,
          });
          return;
        }

        // No indicators at all — try LLM with raw data
        try {
          const prompt = buildAnalystPrompt({
            ticker,
            current_price: data.current_price,
            indicators: {
              rsi_14: null, rsi_1h: null, macd_signal: 'neutral', macd_histogram: null,
              ema_9: null, ema_21: null, ema_50: null, ema_200: null,
              atr_14: null, adx: null,
              bb_upper: null, bb_middle: null, bb_lower: null, bb_width: null, bb_width_regime: null,
              volume_ratio: null, support_levels: [], resistance_levels: [],
              roc_10: null, rsi_divergence: null,
            },
            tradingview: data.tradingview,
            market_context: collectorOutput.market,
            data_freshness: data.data_freshness,
            fundamentals: data.fundamentals,
            news: data.news,
            rss_news: data.news,
          });

          const response = await callLLM('analyst', MODELS.MID, ANALYST_SYSTEM, prompt, 900);
          const parsed = parseJsonResponse<{ analyses: AnalystOutput[] }>(response.content);

          if (parsed.analyses && parsed.analyses.length > 0) {
            results.push(...parsed.analyses.map((analysis) => ({
              ...analysis,
              bias_4h: (analysis.bias_4h || 'NEUTRAL').trim() as AnalystOutput['bias_4h'],
              bias_1h: (analysis.bias_1h || 'NEUTRAL').trim() as AnalystOutput['bias_1h'],
              signal_15m: (analysis.signal_15m || 'NEUTRAL').trim() as AnalystOutput['signal_15m'],
              trade_type: (analysis.trade_type || 'C').trim() as AnalystOutput['trade_type'],
              macd_signal: (analysis.macd_signal || 'neutral').trim(),
              data_quality: data.data_quality,
              data_freshness_score: data.data_freshness.score,
            })));
          }
        } catch (err) {
          console.error(`[Analyst] Failed for ${ticker}:`, err);
          results.push({
            ticker,
            bias_4h: 'NEUTRAL',
            bias_1h: 'NEUTRAL',
            signal_15m: 'NEUTRAL',
            trade_type: 'C',
            entry_price: data.current_price,
            stop_loss: data.current_price * 0.98,
            take_profit: data.current_price * 1.04,
            atr: data.current_price * 0.01,
            rsi_15m: 50,
            rsi_1h: 50,
            macd_signal: 'neutral',
            volume_ratio: 1,
            key_levels: { support: [], resistance: [] },
            candle_pattern: 'unknown',
            confidence: 0,
            skip_reason: `No indicators: ${String(err).slice(0, 100)}`,
            data_quality: data.data_quality,
            data_freshness_score: data.data_freshness.score,
          });
        }
      })
    );

    console.log(`[Analyst] Completed: ${results.length} analyses`);
    return results;
  }

  /** Fully deterministic analysis from pre-computed indicators — no LLM needed */
  private deterministicAnalysis(ticker: string, currentPrice: number, indicators: IndicatorValues): AnalystOutput {
    const bias_4h = compute4HBias(indicators);
    const signal_15m = compute15mSignal(indicators);
    const trade_type = computeTradeType(indicators);

    // Determine 1h bias from RSI + MACD
    let bias_1h: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (indicators.rsi_1h !== null) {
      if (indicators.rsi_1h < 40 && indicators.macd_signal === 'bullish') bias_1h = 'BULLISH';
      else if (indicators.rsi_1h > 60 && indicators.macd_signal === 'bearish') bias_1h = 'BEARISH';
    }

    // Confidence based on alignment + new indicators
    let confidence = 30; // base
    if (bias_4h === bias_1h && bias_4h !== 'NEUTRAL') confidence += 25;
    if (signal_15m !== 'NEUTRAL' && signal_15m === (bias_4h === 'BULLISH' ? 'BUY' : 'SELL')) confidence += 20;
    if (indicators.volume_ratio !== null && indicators.volume_ratio > 1.5) confidence += 10;
    if (indicators.adx !== null && indicators.adx > 25) confidence += 10;
    // Momentum confirmation
    if (indicators.roc_10 !== null) {
      if ((indicators.roc_10 > 2 && signal_15m === 'BUY') || (indicators.roc_10 < -2 && signal_15m === 'SELL')) confidence += 10;
      if ((indicators.roc_10 > 0 && signal_15m === 'SELL') || (indicators.roc_10 < 0 && signal_15m === 'BUY')) confidence -= 10;
    }
    // RSI divergence boost
    if (indicators.rsi_divergence === 'bullish' && signal_15m === 'BUY') confidence += 15;
    if (indicators.rsi_divergence === 'bearish' && signal_15m === 'SELL') confidence += 15;

    // Detect candle patterns from Bollinger Band position (must be before neutral cap check)
    let candle_pattern = 'aucun';
    if (currentPrice < (indicators.bb_lower ?? 0) && currentPrice > 0) candle_pattern = 'sous_bande_inferieure';
    else if (currentPrice > (indicators.bb_upper ?? 0)) candle_pattern = 'au_dessus_bande_superieure';
    else if (indicators.rsi_14 !== null && indicators.rsi_14 < 30) candle_pattern = 'survente';
    else if (indicators.rsi_14 !== null && indicators.rsi_14 > 70) candle_pattern = 'surachat';

    // Override NEUTRAL signal when candle pattern gives clear direction
    // This prevents the bot from ignoring setups with strong reversal/continuation signals
    let finalSignal = signal_15m;
    if (finalSignal === 'NEUTRAL') {
      if (candle_pattern === 'survente' || candle_pattern === 'sous_bande_inferieure') {
        finalSignal = 'BUY';
      } else if (candle_pattern === 'surachat' || candle_pattern === 'au_dessus_bande_superieure') {
        finalSignal = 'SELL';
      }
    }

    // Sanitize: trim to avoid silent string-matching bugs from LLM whitespace
    const cleanBias4h = (bias_4h || '').trim() as 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    const cleanBias1h = (bias_1h || '').trim() as 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    const cleanSignal15m = (finalSignal || '').trim() as 'BUY' | 'SELL' | 'NEUTRAL';

    // Compute entry/stop/TP from final signal (may differ from original NEUTRAL)
    const levels = computeLevels(currentPrice, indicators.atr_14, cleanSignal15m);

    // Penalties — même logique que le prompt LLM
    if (indicators.rsi_14 !== null && indicators.rsi_14 > 75) confidence -= 15; // surachat
    if (indicators.rsi_14 !== null && indicators.rsi_14 < 25 && cleanSignal15m === 'BUY') confidence += 10; // survente rebond
    if (indicators.volume_ratio !== null && indicators.volume_ratio < 0.7) confidence -= 10; // volume faible
    if (indicators.adx !== null && indicators.adx < 15) confidence -= 10; // pas de tendance
    // Candle pattern forced signal → boost confidence (pattern confirms direction)
    if (signal_15m === 'NEUTRAL' && finalSignal !== 'NEUTRAL' && candle_pattern !== 'aucun') {
      confidence += 10;
    }
    // Neutral setup cap — relaxed when volume or pattern confirms
    if (cleanBias4h === 'NEUTRAL' && cleanSignal15m === 'NEUTRAL') {
      const hasVolConfirm = indicators.volume_ratio !== null && indicators.volume_ratio > 1.5;
      const hasPatternConfirm = candle_pattern !== 'aucun';
      if (hasVolConfirm || hasPatternConfirm) {
        confidence = Math.min(confidence, 60); // allow borderline actionable
      } else {
        confidence = Math.min(confidence, 50);
      }
    }

    confidence = Math.min(confidence, 95);
    confidence = Math.max(confidence, 0);

    return {
      ticker,
      bias_4h: cleanBias4h,
      bias_1h: cleanBias1h,
      signal_15m: cleanSignal15m,
      trade_type,
      entry_price: levels.entry,
      stop_loss: levels.stop_loss,
      take_profit: levels.take_profit,
      atr: indicators.atr_14 ?? currentPrice * 0.01,
      rsi_15m: indicators.rsi_14 ?? 50,
      rsi_1h: indicators.rsi_1h ?? 50,
      macd_signal: indicators.macd_signal,
      volume_ratio: indicators.volume_ratio ?? 1,
      key_levels: { support: indicators.support_levels, resistance: indicators.resistance_levels },
      candle_pattern,
      confidence,
      skip_reason: (cleanBias4h === 'NEUTRAL' && cleanSignal15m === 'NEUTRAL')
        ? 'Setup trop neutre, pas de conviction directionnelle'
        : null,
    };
  }
}
