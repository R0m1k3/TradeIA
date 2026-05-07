import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildAnalystPrompt, ANALYST_SYSTEM } from '../prompts/analyst.prompt';
import { compute4HBias, compute15mSignal, computeTradeType, computeLevels, type IndicatorValues } from '../data/indicators';
import type { CollectorOutput } from './collector';

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
    const minLlmConfidence = Math.max(0, parseInt(process.env.ANALYST_LLM_MIN_CONFIDENCE || '55', 10));
    let llmAnalysesUsed = 0;

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
            llmAnalysesUsed++ < maxLlmAnalyses;

          if (!shouldUseLlm) {
            results.push({
              ...deterministic,
              data_quality: data.data_quality,
              data_freshness_score: data.data_freshness.score,
              confidence: data.data_freshness.score < 60 ? Math.min(deterministic.confidence, 55) : deterministic.confidence,
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

            const response = await callLLM('analyst', MODELS.MID, ANALYST_SYSTEM, prompt);
            const parsed = parseJsonResponse<{ analyses: AnalystOutput[] }>(response.content);

            if (parsed.analyses && parsed.analyses.length > 0) {
              // Validate LLM output against deterministic values
              for (const analysis of parsed.analyses) {
                analysis.data_quality = data.data_quality;
                analysis.data_freshness_score = data.data_freshness.score;
                if (data.data_freshness.score < 60) {
                  analysis.confidence = Math.min(analysis.confidence, 55);
                  analysis.skip_reason = analysis.skip_reason || 'Qualité des données limitée';
                }
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
          results.push({
            ...deterministic,
            data_quality: data.data_quality,
            data_freshness_score: data.data_freshness.score,
            confidence: data.data_freshness.score < 60 ? Math.min(deterministic.confidence, 55) : deterministic.confidence,
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

          const response = await callLLM('analyst', MODELS.MID, ANALYST_SYSTEM, prompt);
          const parsed = parseJsonResponse<{ analyses: AnalystOutput[] }>(response.content);

          if (parsed.analyses && parsed.analyses.length > 0) {
            results.push(...parsed.analyses.map((analysis) => ({
              ...analysis,
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
    const levels = computeLevels(currentPrice, indicators.atr_14, signal_15m);

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

    // Penalties — même logique que le prompt LLM
    if (indicators.rsi_14 !== null && indicators.rsi_14 > 75) confidence -= 15; // surachat
    if (indicators.rsi_14 !== null && indicators.rsi_14 < 25 && signal_15m === 'BUY') confidence += 10; // survente rebond
    if (indicators.volume_ratio !== null && indicators.volume_ratio < 0.7) confidence -= 10; // volume faible
    if (indicators.adx !== null && indicators.adx < 15) confidence -= 10; // pas de tendance
    // Neutral setup cap
    if (bias_4h === 'NEUTRAL' && signal_15m === 'NEUTRAL') confidence = Math.min(confidence, 45);

    confidence = Math.min(confidence, 95);
    confidence = Math.max(confidence, 0);

    // Detect candle patterns from Bollinger Band position
    let candle_pattern = 'aucun';
    if (currentPrice < (indicators.bb_lower ?? 0) && currentPrice > 0) candle_pattern = 'sous_bande_inferieure';
    else if (currentPrice > (indicators.bb_upper ?? 0)) candle_pattern = 'au_dessus_bande_superieure';
    else if (indicators.rsi_14 !== null && indicators.rsi_14 < 30) candle_pattern = 'survente';
    else if (indicators.rsi_14 !== null && indicators.rsi_14 > 70) candle_pattern = 'surachat';

    return {
      ticker,
      bias_4h,
      bias_1h,
      signal_15m,
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
      skip_reason: (bias_4h === 'NEUTRAL' && signal_15m === 'NEUTRAL')
        ? 'Setup trop neutre, pas de conviction directionnelle'
        : null,
    };
  }
}
