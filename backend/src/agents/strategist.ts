import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildStrategistPrompt, STRATEGIST_SYSTEM } from '../prompts/strategist.prompt';
import type { DebateOutput } from './researcher';
import type { MarketSegment } from './discovery';
import type { AllocationBudget } from './balance-controller';

export interface SwapCandidate {
  ticker: string;
  segment: MarketSegment;
  days_held: number;
  entry_conviction: number;
  current_pnl_pct: number;
  current_signal: string;
}

export interface OrderProposal {
  ticker: string;
  action: 'BUY' | 'SELL' | 'SWAP';
  swap_sell_ticker?: string;
  trade_type: 'A' | 'B' | 'C';
  limit_price: number;
  stop_loss: number;
  take_profit: number;
  invalidation_condition: string;
  size_pct: number;
  confidence: number;
  debate_score: number;
  bull_conviction: number;
  bear_conviction: number;
  reasoning: string;
}

export class StrategistAgent {
  async run(
    debates: DebateOutput[],
    portfolio: { daily_pnl_pct: number; positions: Array<{ ticker: string; days_held?: number; entry_conviction?: number; pnlPct?: number }> },
    market: { vix: number; fear_greed: number; nasdaq_direction: string },
    heldTickers: string[],
    budget?: AllocationBudget,
    swapCandidates?: SwapCandidate[]
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
        budget,
        swapCandidates,
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
