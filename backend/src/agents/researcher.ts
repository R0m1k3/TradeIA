import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildBullPrompt, BULL_SYSTEM } from '../prompts/bull.prompt';
import { buildBearPrompt, BEAR_SYSTEM } from '../prompts/bear.prompt';
import { broadcastAnalysisEvent } from '../websocket';
import type { AnalystOutput } from './analyst';
import type { CollectorOutput } from './collector';
import type { MarketSegment } from './discovery';
import type { AllocationBudget } from './balance-controller';

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
  async run(
    analystOutputs: AnalystOutput[],
    collector: CollectorOutput,
    ticker_segments?: Record<string, MarketSegment>,
    budget?: AllocationBudget
  ): Promise<DebateOutput[]> {
    const validAnalyses = analystOutputs
      .filter((a) => {
        if (a.confidence <= 0) {
          console.log(`[Researcher] Skip ${a.ticker}: confidence=${a.confidence}, skip_reason="${a.skip_reason ?? 'none'}"`);
          return false;
        }
        if (a.data_quality === 'missing') {
          console.log(`[Researcher] Skip ${a.ticker}: data_quality=missing`);
          return false;
        }
        if (a.skip_reason) {
          console.log(`[Researcher] ${a.ticker}: skip_reason="${a.skip_reason}" (confidence=${a.confidence}) — including with degraded confidence`);
        }
        return true;
      });

    let selectedAnalyses: AnalystOutput[];

    if (budget && ticker_segments && Object.keys(budget.segments).length > 0) {
      // Segment-aware selection: top (slots + 1) per segment, cap at 15 total
      const selectedTickers = new Set<string>();

      for (const [seg, alloc] of Object.entries(budget.segments) as Array<[MarketSegment, { slots: number; candidates_to_analyze: number }]>) {
        const perSegCap = Math.max(alloc.slots * 3, 5);
        const segAnalyses = validAnalyses
          .filter((a) => ticker_segments[a.ticker] === seg)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, perSegCap);

        for (const a of segAnalyses) {
          selectedTickers.add(a.ticker);
        }
      }

      selectedAnalyses = validAnalyses
        .filter((a) => selectedTickers.has(a.ticker))
        .slice(0, 30);
    } else {
      // Backward compat: top 5 globally
      selectedAnalyses = validAnalyses
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);
    }

    console.log(`[Researcher] Starting bull/bear debates for ${selectedAnalyses.length} tickers (4 concurrent)`);

    const CONCURRENCY = 4;
    const results: PromiseSettledResult<DebateOutput | null>[] = [];
    for (let i = 0; i < selectedAnalyses.length; i += CONCURRENCY) {
      const batch = selectedAnalyses.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (analysis) => {
        const tickerData = collector.tickers[analysis.ticker];
        if (!tickerData) return null;

        const inputData = {
          ticker: analysis.ticker,
          analyst_output: analysis,
          fundamentals: tickerData.fundamentals,
          news: tickerData.news,
          sentiment: collector.market,
          tweets: (tickerData as any).tweets,
          current_price: tickerData.current_price,
        };

        const [bullResult, bearResult] = await Promise.allSettled([
          this.runBull(inputData),
          this.runBear(inputData),
        ]);

        const bull: BullOutput =
          bullResult.status === 'fulfilled'
            ? bullResult.value
            : this.buildFallbackBull(analysis);

        const bear: BearOutput =
          bearResult.status === 'fulfilled'
            ? bearResult.value
            : this.buildFallbackBear(analysis);

        const debate: DebateOutput = {
          ticker: analysis.ticker,
          bull,
          bear,
          debate_score: bull.conviction - bear.conviction,
          analyst_output: analysis,
        };

        // Broadcast debate in real-time so UI updates as each ticker completes
        broadcastAnalysisEvent({
          id: `debate-${analysis.ticker}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          agent: debate.debate_score > 0 ? 'bull' : 'bear',
          stage: 'debate',
          title: `${analysis.ticker} — débat bull vs bear`,
          summary_simple: debate.debate_score > 0
            ? `Avantage haussier sur ${analysis.ticker}. Bull ${bull.conviction}/10 vs Bear ${bear.conviction}/10.`
            : debate.debate_score < 0
              ? `Avantage baissier sur ${analysis.ticker}. Bear ${bear.conviction}/10 vs Bull ${bull.conviction}/10.`
              : `Avis partagés sur ${analysis.ticker}. Conviction égale ${bull.conviction}/10.`,
          summary_expert: `BULL: ${bull.technical_case}\n\nBEAR: ${bear.technical_case}`,
          confidence: analysis.confidence,
          ticker: analysis.ticker,
        });

        return debate;
      }));
      results.push(...batchResults);
    }

    const validDebates = results
      .filter((r): r is PromiseFulfilledResult<DebateOutput> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);

    console.log(`[Researcher] Completed ${validDebates.length} debates`);
    return validDebates;
  }

  private async runBull(data: Parameters<typeof buildBullPrompt>[0]): Promise<BullOutput> {
    const prompt = buildBullPrompt(data);
    const models = await getModels();
    const response = await callLLM('bull-researcher', models.MID, BULL_SYSTEM, prompt, 600);
    return parseJsonResponse<BullOutput>(response.content);
  }

  private async runBear(data: Parameters<typeof buildBearPrompt>[0]): Promise<BearOutput> {
    const prompt = buildBearPrompt(data);
    const models = await getModels();
    const response = await callLLM('bear-researcher', models.MID, BEAR_SYSTEM, prompt, 600);
    return parseJsonResponse<BearOutput>(response.content);
  }

  private buildFallbackBull(analysis: AnalystOutput): BullOutput {
    const hasBullBias = analysis.bias_4h === 'BULLISH' || analysis.bias_1h === 'BULLISH' || analysis.signal_15m === 'BUY';
    const upsidePct = analysis.entry_price > 0
      ? Math.max(0, ((analysis.take_profit - analysis.entry_price) / analysis.entry_price) * 100)
      : 0;

    return {
      ticker: analysis.ticker,
      upside_pct: Math.round(upsidePct * 100) / 100,
      technical_case: hasBullBias
        ? `${analysis.ticker}: biais haussier partiel, RSI ${analysis.rsi_15m.toFixed(1)} et MACD ${analysis.macd_signal}.`
        : `${analysis.ticker}: pas assez de confirmation haussière, signal technique majoritairement neutre.`,
      fundamental_catalyst: 'Non évalué sur ce cycle; décision basée sur les indicateurs techniques disponibles.',
      sentiment_driver: `Confiance analyste ${analysis.confidence}%, fraîcheur données ${analysis.data_freshness_score ?? 'N/A'}/100.`,
      bear_rebuttal_1: `Support principal ${analysis.key_levels.support[0]?.toFixed(4) ?? 'non identifié'}.`,
      bear_rebuttal_2: `Objectif technique ${analysis.take_profit.toFixed(4)} si le prix confirme.`,
      conviction: hasBullBias ? Math.max(2, Math.round(analysis.confidence / 20)) : 1,
      invalidation_condition: `Cassure sous ${analysis.stop_loss.toFixed(4)} ou perte du support.`,
      key_risk: 'Débat LLM indisponible; conviction réduite automatiquement.',
    };
  }

  private buildFallbackBear(analysis: AnalystOutput): BearOutput {
    const hasBearBias = analysis.bias_4h === 'BEARISH' || analysis.bias_1h === 'BEARISH' || analysis.signal_15m === 'SELL';
    const downsidePct = analysis.entry_price > 0
      ? Math.max(0, ((analysis.entry_price - analysis.stop_loss) / analysis.entry_price) * 100)
      : 0;

    return {
      ticker: analysis.ticker,
      downside_pct: Math.round(downsidePct * 100) / 100,
      technical_case: hasBearBias
        ? `${analysis.ticker}: pression baissière possible, RSI ${analysis.rsi_15m.toFixed(1)} et MACD ${analysis.macd_signal}.`
        : `${analysis.ticker}: risque baissier contenu, mais setup encore trop neutre pour acheter fort.`,
      structural_weakness: `Résistance proche ${analysis.key_levels.resistance[0]?.toFixed(4) ?? 'non identifiée'}.`,
      macro_headwind: 'Contexte macro/sentiment non tranché sur ce cycle.',
      bull_rebuttal_1: `Le signal 15m est ${analysis.signal_15m}, donc pas de rejet fort sans cassure.`,
      bull_rebuttal_2: `La confiance analyste reste à ${analysis.confidence}%, prudence avant toute exposition.`,
      conviction: hasBearBias ? Math.max(2, Math.round(analysis.confidence / 20)) : 1,
      invalidation_condition: `Reprise au-dessus de ${analysis.take_profit.toFixed(4)} avec volume.`,
      strongest_bull_argument: 'La thèse haussière reprendrait du poids si support tenu et momentum positif.',
    };
  }
}
