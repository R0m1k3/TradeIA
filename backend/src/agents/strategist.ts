import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildStrategistPrompt, STRATEGIST_SYSTEM } from '../prompts/strategist.prompt';
import type { DebateOutput } from './researcher';

export interface OrderProposal {
  ticker: string;
  action: 'BUY' | 'SELL';
  trade_type: 'A' | 'B' | 'C';
  limit_price: number;
  stop_loss: number;
  take_profit: number;
  invalidation_condition: string;
  risk_pct: number;
  confidence: number;
  debate_score: number;
  bull_conviction: number;
  bear_conviction: number;
  reasoning: string;
}

export class StrategistAgent {
  async run(
    debates: DebateOutput[],
    portfolio: { daily_pnl_pct: number; positions: { ticker: string }[] },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    heldTickers: string[]
  ): Promise<OrderProposal[]> {
    console.log(`[Strategist] Processing ${debates.length} debate outcomes`);
    const MODELS = await getModels();

    if (debates.length === 0) {
      console.log('[Strategist] No debates to process, returning []');
      return [];
    }

    try {
      const prompt = buildStrategistPrompt({
        debates,
        portfolio,
        market,
        held_tickers: heldTickers,
      });

      const response = await callLLM('strategist', MODELS.STRONG, STRATEGIST_SYSTEM, prompt);
      const parsed = parseJsonResponse<OrderProposal[]>(response.content);

      if (!Array.isArray(parsed)) {
        console.warn('[Strategist] Response was not an array, returning []');
        return [];
      }

      console.log(`[Strategist] Generated ${parsed.length} order proposals`);
      return parsed;
    } catch (err) {
      console.error('[Strategist] Error:', err);
      return [];
    }
  }
}
