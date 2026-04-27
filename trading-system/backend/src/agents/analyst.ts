import { callLLM, parseJsonResponse } from '../llm/client';
import { MODELS } from '../llm/models';
import { buildAnalystPrompt, ANALYST_SYSTEM } from '../prompts/analyst.prompt';
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
}

export class AnalystAgent {
  async run(collectorOutput: CollectorOutput): Promise<AnalystOutput[]> {
    console.log('[Analyst] Starting multi-timeframe analysis');
    const results: AnalystOutput[] = [];

    await Promise.all(
      Object.entries(collectorOutput.tickers).map(async ([ticker, data]) => {
        if (data.data_quality === 'missing') {
          console.log(`[Analyst] Skipping ${ticker} — missing data`);
          return;
        }

        try {
          const prompt = buildAnalystPrompt({
            ticker,
            ohlcv_15m: data.ohlcv_15m,
            ohlcv_1h: data.ohlcv_1h,
            ohlcv_4h: data.ohlcv_4h,
            current_price: data.current_price,
          });

          const response = await callLLM('analyst', MODELS.MID, ANALYST_SYSTEM, prompt);
          const parsed = parseJsonResponse<{ analyses: AnalystOutput[] }>(response.content);

          if (parsed.analyses && parsed.analyses.length > 0) {
            results.push(...parsed.analyses);
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
            skip_reason: `Analysis error: ${String(err).slice(0, 100)}`,
          });
        }
      })
    );

    console.log(`[Analyst] Completed: ${results.length} analyses`);
    return results;
  }
}
