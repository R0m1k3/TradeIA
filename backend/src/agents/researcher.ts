import { callLLM, parseJsonResponse } from '../llm/client';
import { getModels } from '../llm/models';
import { buildBullPrompt, BULL_SYSTEM } from '../prompts/bull.prompt';
import { buildBearPrompt, BEAR_SYSTEM } from '../prompts/bear.prompt';
import { broadcastAnalysisEvent } from '../websocket';
import type { AnalystOutput } from './analyst';
import type { CollectorOutput, TickerData } from './collector';
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

interface NewsItemLite {
  title?: string;
  sentiment_hint?: 'positive' | 'negative' | 'neutral' | string;
  source?: string;
}

interface MarketLite {
  fear_greed?: number;
  vix?: number;
  internals?: { risk_regime?: string };
  sector_biases?: Record<string, { direction?: string; change_pct?: number }>;
}

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function countNewsSentiment(news: NewsItemLite[] | undefined): { pos: number; neg: number } {
  if (!news || news.length === 0) return { pos: 0, neg: 0 };
  let pos = 0, neg = 0;
  for (const n of news.slice(0, 10)) {
    if (n.sentiment_hint === 'positive') pos++;
    else if (n.sentiment_hint === 'negative') neg++;
  }
  return { pos, neg };
}

/**
 * Deterministic bull conviction (1-10) — used as FALLBACK when LLM fails.
 * Score combines technicals, macro context and news sentiment.
 */
function computeBullConvictionDeterministic(
  analysis: AnalystOutput,
  market: MarketLite,
  news: NewsItemLite[] | undefined
): number {
  let score = 1;
  if (analysis.bias_4h === 'BULLISH') score += 3;
  else if (analysis.bias_4h === 'BEARISH') score -= 2;
  if (analysis.bias_1h === 'BULLISH') score += 2;
  else if (analysis.bias_1h === 'BEARISH') score -= 1;
  if (analysis.signal_15m === 'BUY') score += 2;
  else if (analysis.signal_15m === 'SELL') score -= 2;
  if (analysis.macd_signal === 'bullish') score += 1;
  if (analysis.volume_ratio > 1.5) score += 1;
  else if (analysis.volume_ratio < 0.7) score -= 1;
  if (analysis.rsi_15m < 30) score += 2;
  else if (analysis.rsi_15m > 75) score -= 2;
  if (analysis.confidence >= 70) score += 1;
  else if (analysis.confidence < 40) score -= 1;
  const fg = market.fear_greed ?? 50;
  if (fg < 25) score += 1;
  else if (fg > 80) score -= 1;
  if ((market.vix ?? 20) > 28) score -= 1;
  const { pos, neg } = countNewsSentiment(news);
  if (pos >= 2 && pos > neg) score += 1;
  else if (neg >= 2 && neg > pos) score -= 1;
  return clip(score, 1, 10);
}

function computeBearConvictionDeterministic(
  analysis: AnalystOutput,
  market: MarketLite,
  news: NewsItemLite[] | undefined
): number {
  let score = 1;
  if (analysis.bias_4h === 'BEARISH') score += 3;
  else if (analysis.bias_4h === 'BULLISH') score -= 2;
  if (analysis.bias_1h === 'BEARISH') score += 2;
  else if (analysis.bias_1h === 'BULLISH') score -= 1;
  if (analysis.signal_15m === 'SELL') score += 2;
  else if (analysis.signal_15m === 'BUY') score -= 2;
  if (analysis.macd_signal === 'bearish') score += 1;
  if (analysis.volume_ratio < 0.7) score += 1;
  else if (analysis.volume_ratio > 1.5 && analysis.signal_15m === 'BUY') score -= 1;
  if (analysis.rsi_15m > 75) score += 2;
  else if (analysis.rsi_15m < 30) score -= 1;
  if (analysis.confidence < 40) score += 1;
  const fg = market.fear_greed ?? 50;
  if (fg > 80) score += 1;
  else if (fg < 25) score -= 1;
  if ((market.vix ?? 20) > 28) score += 1;
  const { pos, neg } = countNewsSentiment(news);
  if (neg >= 2 && neg > pos) score += 1;
  else if (pos >= 2 && pos > neg) score -= 1;
  return clip(score, 1, 10);
}

function buildFallbackBull(analysis: AnalystOutput, market: MarketLite, news: NewsItemLite[] | undefined): BullOutput {
  const support = analysis.key_levels.support[0]?.toFixed(2) ?? 'non identifié';
  const resistance = analysis.key_levels.resistance[0]?.toFixed(2) ?? 'non identifiée';
  const { pos: posNews } = countNewsSentiment(news);
  const upsidePct = analysis.entry_price > 0
    ? Math.max(0, ((analysis.take_profit - analysis.entry_price) / analysis.entry_price) * 100)
    : 0;

  const technicalParts: string[] = [];
  if (analysis.bias_4h === 'BULLISH') technicalParts.push(`tendance 4H haussière (EMA alignées)`);
  if (analysis.bias_1h === 'BULLISH') technicalParts.push(`1H confirme la dynamique`);
  if (analysis.signal_15m === 'BUY') technicalParts.push(`entrée 15m active`);
  if (analysis.macd_signal === 'bullish') technicalParts.push(`MACD positif`);
  if (analysis.rsi_15m < 35) technicalParts.push(`RSI ${analysis.rsi_15m.toFixed(1)} en zone de rebond`);
  if (analysis.volume_ratio > 1.5) technicalParts.push(`volume ${analysis.volume_ratio.toFixed(1)}× la moyenne`);

  return {
    ticker: analysis.ticker,
    upside_pct: Math.round(upsidePct * 100) / 100,
    conviction: computeBullConvictionDeterministic(analysis, market, news),
    technical_case: technicalParts.length > 0
      ? `${analysis.ticker}: ${technicalParts.join(', ')}. Support ${support}, objectif ${analysis.take_profit.toFixed(2)}.`
      : `${analysis.ticker}: setup technique neutre, peu de signaux haussiers exploitables. Support ${support}.`,
    fundamental_catalyst: posNews >= 2
      ? `${posNews} actualités à tonalité positive dans les dernières 48h.`
      : 'Pas de catalyseur fondamental majeur identifié; thèse purement technique.',
    sentiment_driver: (() => {
      const fg = market.fear_greed ?? 50;
      return fg < 30 ? `Fear & Greed ${fg} — opportunité contrarienne possible.`
        : fg > 65 ? `Fear & Greed ${fg} — appétit pour le risque favorable.`
        : `Sentiment neutre (F&G ${fg}).`;
    })(),
    bear_rebuttal_1: `Le stop ${analysis.stop_loss.toFixed(2)} protège contre une cassure du support ${support}.`,
    bear_rebuttal_2: `Le R/R cible 1:${((analysis.take_profit - analysis.entry_price) / Math.max(0.01, analysis.entry_price - analysis.stop_loss)).toFixed(1)} compense un win rate < 50%.`,
    invalidation_condition: `Cassure et clôture sous ${analysis.stop_loss.toFixed(2)}, ou MACD bascule baissier.`,
    key_risk: `Résistance proche ${resistance} pouvant freiner la progression. (Fallback LLM)`,
  };
}

function buildFallbackBear(analysis: AnalystOutput, market: MarketLite, news: NewsItemLite[] | undefined): BearOutput {
  const support = analysis.key_levels.support[0]?.toFixed(2) ?? 'non identifié';
  const resistance = analysis.key_levels.resistance[0]?.toFixed(2) ?? 'non identifiée';
  const { neg: negNews } = countNewsSentiment(news);
  const downsidePct = analysis.entry_price > 0
    ? Math.max(0, ((analysis.entry_price - analysis.stop_loss) / analysis.entry_price) * 100)
    : 0;

  const technicalParts: string[] = [];
  if (analysis.bias_4h === 'BEARISH') technicalParts.push(`tendance 4H baissière`);
  if (analysis.bias_1h === 'BEARISH') technicalParts.push(`1H confirme la faiblesse`);
  if (analysis.signal_15m === 'SELL') technicalParts.push(`signal vendeur 15m`);
  if (analysis.macd_signal === 'bearish') technicalParts.push(`MACD négatif`);
  if (analysis.rsi_15m > 70) technicalParts.push(`RSI ${analysis.rsi_15m.toFixed(1)} en surachat`);
  if (analysis.volume_ratio < 0.7) technicalParts.push(`volume faible ${analysis.volume_ratio.toFixed(1)}×`);

  const vix = market.vix ?? 20;
  const fg = market.fear_greed ?? 50;

  return {
    ticker: analysis.ticker,
    downside_pct: Math.round(downsidePct * 100) / 100,
    conviction: computeBearConvictionDeterministic(analysis, market, news),
    technical_case: technicalParts.length > 0
      ? `${analysis.ticker}: ${technicalParts.join(', ')}. Résistance ${resistance} pesante.`
      : `${analysis.ticker}: pas de signal baissier fort, mais setup pas convaincant pour acheter agressivement.`,
    structural_weakness: analysis.bias_4h === 'BEARISH'
      ? `EMA 4H désalignées (9 < 21 < 50), structure de tendance dégradée.`
      : `Résistance immédiate ${resistance}; échec à casser = rejet et retour vers support.`,
    macro_headwind: vix > 25
      ? `VIX ${vix.toFixed(1)} élevé — volatilité défavorable aux longs.`
      : fg > 80
        ? `F&G ${fg} en zone d'avidité extrême — risque de correction.`
        : `Contexte macro neutre, mais pas de vent porteur identifié.`,
    bull_rebuttal_1: `Le support ${support} peut tenir si volume acheteur revient.`,
    bull_rebuttal_2: negNews < 2
      ? `Pas de news négative significative pour catalyser une chute.`
      : `${negNews} news négatives déjà intégrées au prix.`,
    invalidation_condition: `Cassure et clôture au-dessus de ${analysis.take_profit.toFixed(2)} avec volume soutenu.`,
    strongest_bull_argument: analysis.bias_4h === 'BULLISH'
      ? `La tendance 4H reste structurellement haussière.`
      : `Un rebond technique reste possible depuis le support ${support}. (Fallback LLM)`,
  };
}

export class ResearcherAgent {
  async run(
    analystOutputs: AnalystOutput[],
    collector: CollectorOutput,
    ticker_segments?: Record<string, MarketSegment>,
    budget?: AllocationBudget,
    heldTickers?: string[]
  ): Promise<DebateOutput[]> {
    const validAnalyses = analystOutputs.filter((a) => {
      if (a.confidence <= 0) {
        console.log(`[Researcher] Skip ${a.ticker}: confidence=${a.confidence}, skip_reason="${a.skip_reason ?? 'none'}"`);
        return false;
      }
      if (a.data_quality === 'missing') {
        console.log(`[Researcher] Skip ${a.ticker}: data_quality=missing`);
        return false;
      }
      return true;
    });

    let selectedAnalyses: AnalystOutput[];

    if (budget && ticker_segments && Object.keys(budget.segments).length > 0) {
      const selectedTickers = new Set<string>();
      for (const [seg, alloc] of Object.entries(budget.segments) as Array<[MarketSegment, { slots: number; candidates_to_analyze: number }]>) {
        const perSegCap = Math.max(alloc.slots * 3, 5);
        const segAnalyses = validAnalyses
          .filter((a) => ticker_segments[a.ticker] === seg)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, perSegCap);
        for (const a of segAnalyses) selectedTickers.add(a.ticker);
      }
      selectedAnalyses = validAnalyses
        .filter((a) => selectedTickers.has(a.ticker))
        .slice(0, 12);
    } else {
      selectedAnalyses = validAnalyses
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);
    }

    // Always include held tickers — strategist needs exit signal data for positions
    if (heldTickers && heldTickers.length > 0) {
      const heldInAnalysis = validAnalyses.filter(
        (a) => heldTickers.includes(a.ticker) && !selectedAnalyses.some((s) => s.ticker === a.ticker)
      );
      if (heldInAnalysis.length > 0) {
        console.log(`[Researcher] Force-including ${heldInAnalysis.length} held tickers: ${heldInAnalysis.map((a) => a.ticker).join(', ')}`);
        selectedAnalyses = [...selectedAnalyses, ...heldInAnalysis];
      }
    }

    console.log(`[Researcher] Starting bull/bear debates for ${selectedAnalyses.length} tickers (4 concurrent)`);

    const market = collector.market as MarketLite;
    const CONCURRENCY = 4;
    const results: PromiseSettledResult<DebateOutput | null>[] = [];

    for (let i = 0; i < selectedAnalyses.length; i += CONCURRENCY) {
      const batch = selectedAnalyses.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (analysis) => {
        const tickerData = collector.tickers[analysis.ticker];
        if (!tickerData) return null;

        const news = (tickerData.news as NewsItemLite[] | undefined) ?? [];

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

        const bull: BullOutput = bullResult.status === 'fulfilled'
          ? bullResult.value
          : buildFallbackBull(analysis, market, news);

        const bear: BearOutput = bearResult.status === 'fulfilled'
          ? bearResult.value
          : buildFallbackBear(analysis, market, news);

        const debate: DebateOutput = {
          ticker: analysis.ticker,
          bull,
          bear,
          debate_score: bull.conviction - bear.conviction,
          analyst_output: analysis,
        };

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
}
