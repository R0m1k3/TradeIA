import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildBullPrompt, BULL_SYSTEM } from '../prompts/bull.prompt';
import { buildBearPrompt, BEAR_SYSTEM } from '../prompts/bear.prompt';
import type { AnalystOutput } from './analyst';
import type { CollectorOutput } from './collector';

export interface BullOutput {
  ticker: string;
  upside_pct: number;
  technical_case: string;
  fundamental_catalyst: string;
  sentiment_driver: string;
  bear_rebuttal_1: string;
  bear_rebuttal_2: string;
  conviction: number;
  invalidation_condition: string;
  key_risk: string;
}

export interface BearOutput {
  ticker: string;
  downside_pct: number;
  technical_case: string;
  structural_weakness: string;
  macro_headwind: string;
  bull_rebuttal_1: string;
  bull_rebuttal_2: string;
  conviction: number;
  invalidation_condition: string;
  strongest_bull_argument: string;
}

export interface DebateOutput {
  ticker: string;
  bull: BullOutput;
  bear: BearOutput;
  debate_score: number;
  analyst_output: AnalystOutput;
}

export class ResearcherAgent {
  async run(analystOutputs: AnalystOutput[], collector: CollectorOutput): Promise<DebateOutput[]> {
    const MODELS = await getModels();
    console.log(`[Researcher] Starting bull/bear debates for ${analystOutputs.length} tickers`);

    const debates = await Promise.all(
      analystOutputs
        .filter((a) => a.confidence > 0 && !a.skip_reason)
        .map(async (analysis) => {
          const tickerData = collector.tickers[analysis.ticker];
          if (!tickerData) return null;

          const inputData = {
            ticker: analysis.ticker,
            analyst_output: analysis,
            fundamentals: tickerData.fundamentals,
            news: tickerData.news,
            sentiment: tickerData.sentiment,
            current_price: tickerData.current_price,
          };

          // Run bull and bear in parallel
          const [bullResult, bearResult] = await Promise.allSettled([
            this.runBull(inputData),
            this.runBear(inputData),
          ]);

          const bull: BullOutput =
            bullResult.status === 'fulfilled'
              ? bullResult.value
              : {
                  ticker: analysis.ticker,
                  upside_pct: 0,
                  technical_case: 'analysis unavailable',
                  fundamental_catalyst: '',
                  sentiment_driver: '',
                  bear_rebuttal_1: '',
                  bear_rebuttal_2: '',
                  conviction: 1,
                  invalidation_condition: '',
                  key_risk: '',
                };

          const bear: BearOutput =
            bearResult.status === 'fulfilled'
              ? bearResult.value
              : {
                  ticker: analysis.ticker,
                  downside_pct: 0,
                  technical_case: 'analysis unavailable',
                  structural_weakness: '',
                  macro_headwind: '',
                  bull_rebuttal_1: '',
                  bull_rebuttal_2: '',
                  conviction: 1,
                  invalidation_condition: '',
                  strongest_bull_argument: '',
                };

          const debate_score = bull.conviction - bear.conviction;

          return {
            ticker: analysis.ticker,
            bull,
            bear,
            debate_score,
            analyst_output: analysis,
          } as DebateOutput;
        })
    );

    const validDebates = debates.filter((d): d is DebateOutput => d !== null);
    console.log(`[Researcher] Completed ${validDebates.length} debates`);
    return validDebates;
  }

  private async runBull(data: Parameters<typeof buildBullPrompt>[0]): Promise<BullOutput> {
    const prompt = buildBullPrompt(data);
    const response = await callLLM('bull-researcher', MODELS.MID, BULL_SYSTEM, prompt);
    return parseJsonResponse<BullOutput>(response.content);
  }

  private async runBear(data: Parameters<typeof buildBearPrompt>[0]): Promise<BearOutput> {
    const prompt = buildBearPrompt(data);
    const response = await callLLM('bear-researcher', MODELS.MID, BEAR_SYSTEM, prompt);
    return parseJsonResponse<BearOutput>(response.content);
  }
}
