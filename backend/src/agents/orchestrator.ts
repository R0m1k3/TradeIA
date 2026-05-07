import { DiscoveryAgent } from './discovery';
import { CollectorAgent } from './collector';
import { AnalystAgent } from './analyst';
import { ResearcherAgent } from './researcher';
import { StrategistAgent } from './strategist';
import { RiskAgent } from './risk';
import { ReporterAgent } from './reporter';
import { BalanceController } from './balance-controller';
import { classifyRegime } from './regime';
import { executeOrder, getPortfolioState, markToMarket, closeTrade, updateEquityPeak } from '../broker/mock';
import { detectStrategyDecay } from '../broker/backtest';
import { prisma } from '../lib/prisma';
import { getCredential } from '../config/credentials';
import { broadcastAlert } from '../websocket';
import { getNasdaqStatus } from '../routes/market';
import { isEuropeanMarketOpen } from '../data/european-markets';
import { getYahooVIX, getFearAndGreed } from '../data/yahoo';
import { getTickerSector } from '../data/sectors';
import type { SwapCandidate, OrderProposal } from './strategist';
import type { MarketSegment } from './discovery';
import type { SectorBias } from '../data/sectors';
import type { Position } from '../broker/mock';
import { saveSnapshots } from '../models/ticker-snapshot';
import { saveNotes } from '../models/ticker-note';

const CYCLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours max par cycle

/**
 * Strategy decay monitor — runs at most once per day.
 * If recent 30 trades win-rate < 50% of historical 60 trades, flag and broadcast critical alert.
 * Does NOT auto-pause (operator decision) but logs prominently.
 */
async function maybeRunDecayCheck(reporter: ReporterAgent): Promise<void> {
  try {
    const last = await prisma.config.findUnique({ where: { key: 'last_decay_check' } });
    const lastMs = last ? new Date(last.value).getTime() : 0;
    if (Date.now() - lastMs < 24 * 3600 * 1000) return;

    const decay = await detectStrategyDecay();
    await prisma.config.upsert({
      where: { key: 'last_decay_check' },
      update: { value: new Date().toISOString() },
      create: { key: 'last_decay_check', value: new Date().toISOString() },
    });

    if (decay.decay_detected) {
      console.error(`[Orchestrator] ${decay.message}`);
      broadcastAlert('critical', `⚠️ STRATEGY DECAY — ${decay.message}`);
      reporter.updateAgent('reporter', { status: 'error', error: decay.message });
    } else {
      console.log(`[Orchestrator] Decay check OK: ${decay.message}`);
    }
  } catch (err) {
    console.warn('[Orchestrator] Decay check failed:', (err as Error).message);
  }
}

/**
 * Relative weakness exit: si le secteur monte fortement (+1.5%) mais la position est dans le rouge,
 * c'est un signal de fuite de capitaux → vendre défensivement.
 */
function generateWeaknessExits(
  positions: Position[],
  sectorBiases: Record<string, SectorBias>
): OrderProposal[] {
  const sells: OrderProposal[] = [];
  for (const pos of positions) {
    const daysHeld = pos.days_held ?? 0;
    const pnlPct = pos.pnlPct ?? 0;
    if (daysHeld < 1) continue;   // Pas de sortie le jour même
    if (pnlPct >= 0) continue;    // Position en profit → garder
    const sector = getTickerSector(pos.ticker);
    const bias = sectorBiases[sector];
    if (!bias || bias.direction !== 'bullish' || bias.change_pct < 1.5) continue;
    // Secteur +1.5% mais position rouge = vraie faiblesse relative
    console.log(`[Orchestrator] Faiblesse relative: ${pos.ticker} ${pnlPct.toFixed(1)}% vs secteur ${sector} +${bias.change_pct.toFixed(1)}%`);
    sells.push({
      ticker: pos.ticker,
      action: 'SELL',
      trade_type: 'C',
      limit_price: pos.currentPrice,
      stop_loss: 0,
      take_profit: 0,
      invalidation_condition: `Faiblesse relative vs secteur ${sector}`,
      size_pct: 100,
      confidence: 75,
      debate_score: 0,
      bull_conviction: 1,
      bear_conviction: 8,
      reasoning: `Faiblesse relative: secteur ${sector} +${bias.change_pct.toFixed(1)}% (${bias.etf}) mais ${pos.ticker} à ${pnlPct.toFixed(1)}% après ${daysHeld.toFixed(0)}j. Vente défensive.`,
    });
  }
  return sells;
}

let isRunning = false;

function cycleTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Cycle timeout after 4 hours')), CYCLE_TIMEOUT_MS)
  );
}

async function checkCircuitBreaker(
  portfolioUsd: number,
  maxDrawdownPct: number,
  reporter: ReporterAgent
): Promise<boolean> {
  const portfolio = await getPortfolioState(portfolioUsd);

  // Drawdown from equity peak (not initial capital)
  const drawdownPct = portfolio.drawdown_from_peak_pct;
  const drawdownFromCapital = ((portfolio.initial_capital - portfolio.total_usd) / portfolio.initial_capital) * 100;

  if (drawdownPct <= -maxDrawdownPct || drawdownFromCapital >= maxDrawdownPct) {
    console.error(`[Orchestrator] CIRCUIT BREAKER: drawdown-from-peak ${drawdownPct.toFixed(2)}%, from-capital ${drawdownFromCapital.toFixed(2)}%`);

    // Fermer toutes les positions ouvertes
    const openTrades = await prisma.trade.findMany({ where: { closedAt: null, action: 'BUY' } });
    for (const trade of openTrades) {
      await closeTrade(trade.id, trade.filledPrice, 'CIRCUIT_BREAKER');
    }

    // Pause forcée via config
    await prisma.config.upsert({
      where: { key: 'system_paused' },
      update: { value: 'true' },
      create: { key: 'system_paused', value: 'true' },
    });
    await prisma.config.upsert({
      where: { key: 'circuit_breaker_triggered_at' },
      update: { value: new Date().toISOString() },
      create: { key: 'circuit_breaker_triggered_at', value: new Date().toISOString() },
    });

    broadcastAlert('critical',
      `🚨 CIRCUIT BREAKER — Drawdown pic ${drawdownPct.toFixed(2)}% — ${openTrades.length} positions fermées — Trading suspendu`
    );

    reporter.updateAgent('reporter', { status: 'error', error: 'Circuit breaker triggered' });
    return true;
  }
  return false;
}

async function runPipelineInternal(reporter: ReporterAgent): Promise<void> {
  const cycleStart = Date.now();

  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const lossLimitRaw = await getCredential('daily_loss_limit_pct', 'DAILY_LOSS_LIMIT_PCT');
  const dailyLossLimitPct = parseFloat(lossLimitRaw || '3');
  const maxDrawdownRaw = await getCredential('max_drawdown_pct', 'MAX_DRAWDOWN_PCT');
  const maxDrawdownPct = parseFloat(maxDrawdownRaw || '10');
  console.log(`[Orchestrator] === CYCLE START (Capital: $${portfolioUsd}) ===`, new Date().toISOString());

  reporter.updateAgent('collector', { status: 'running' });

  // Step 1: Mark to market positions existantes
  await markToMarket();

  // Step 2: Circuit breaker check
  const circuitTriggered = await checkCircuitBreaker(portfolioUsd, maxDrawdownPct, reporter);
  if (circuitTriggered) {
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  // Step 3: Get portfolio state early (needed for balance controller)
  const portfolioForBudget = await getPortfolioState(portfolioUsd);

  // Step 3a: Get market context for balance controller
  const nasdaq = getNasdaqStatus();
  const euOpen = isEuropeanMarketOpen(new Date());
  const vix = await getYahooVIX() ?? 20;
  const fearGreed = await getFearAndGreed() ?? 50;

  // Step 3a.1: Classify market regime — drives sizing + strategy preference
  const regime = await classifyRegime(vix);
  console.log(`[Orchestrator] Regime: ${regime.regime} (conf ${regime.confidence}) — ${regime.reason}`);

  // Step 3a.2: Strategy decay check (1× per day)
  await maybeRunDecayCheck(reporter);

  // Step 3b: Compute allocation budget — regime affects total slot count
  const balanceController = new BalanceController();
  const budget = balanceController.compute({
    nasdaq_open: nasdaq.isOpen,
    eu_open: euOpen,
    vix,
    fear_greed: fearGreed,
    existing_positions: portfolioForBudget.positions.map((p) => ({
      ticker: p.ticker,
      segment: undefined as MarketSegment | undefined,
    })),
    segments_map: {},
    regime,
  });

  // Step 4: Discovery (budget-aware)
  reporter.updateAgent('collector', { status: 'running' });
  const discovery = new DiscoveryAgent();
  const discoveryResult = await discovery.run(budget);

  // Fix existing positions segment mapping now that we have segments
  const budgetWithSegments = balanceController.compute({
    nasdaq_open: nasdaq.isOpen,
    eu_open: euOpen,
    vix,
    fear_greed: fearGreed,
    existing_positions: portfolioForBudget.positions.map((p) => ({
      ticker: p.ticker,
      segment: discoveryResult.segments[p.ticker],
    })),
    segments_map: discoveryResult.segments,
    regime,
  });

  if (discoveryResult.tickers.length === 0) {
    console.log('[Orchestrator] Discovery returned no active assets, ending cycle');
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  console.log(`[Orchestrator] Processing ${discoveryResult.tickers.length} tickers`);

  // Step 5: Collect data
  const collector = new CollectorAgent();
  const collectorOutput = await collector.run(discoveryResult.tickers);
  reporter.updateAgent('collector', {
    status: collectorOutput ? 'ok' : 'error',
    lastRun: new Date().toISOString(),
  });

  if (!collectorOutput) {
    console.error('[Orchestrator] Collector failed, aborting cycle');
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  // Persist latest OHLCV bars for history tracking
  for (const [ticker, data] of Object.entries(collectorOutput.tickers)) {
    if ((data.ohlcv_1h as any[])?.length > 0) {
      await saveSnapshots(ticker, '1h', data.ohlcv_1h as any);
    }
  }

  // Step 6: Technical analysis
  reporter.updateAgent('analyst', { status: 'running' });
  const analyst = new AnalystAgent();
  const analystOutputs = await analyst.run(collectorOutput);
  reporter.updateAgent('analyst', { status: 'ok', lastRun: new Date().toISOString() });

  // Persist technical analysis notes
  if (analystOutputs.length > 0) {
    const techNotes = analystOutputs.map((a) => ({
      ticker: a.ticker,
      noteType: 'technique',
      content: `Signal ${a.signal_15m}, biais 4H/1H ${a.bias_4h}/${a.bias_1h}, RSI ${a.rsi_15m}, MACD ${a.macd_signal}, pattern ${a.candle_pattern}.`,
      confidence: a.confidence,
      metadata: {
        rsi_15m: a.rsi_15m,
        rsi_1h: a.rsi_1h,
        macd_signal: a.macd_signal,
        volume_ratio: a.volume_ratio,
        trade_type: a.trade_type,
        atr: a.atr,
      },
    }));
    await saveNotes(techNotes).catch((err) => console.warn('[Orchestrator] Failed to save tech notes:', err));
  }

  // Step 7: Bull/Bear debate (segment-aware)
  reporter.updateAgent('bull', { status: 'running' });
  reporter.updateAgent('bear', { status: 'running' });
  const researcher = new ResearcherAgent();
  const debateOutputs = await researcher.run(
    analystOutputs,
    collectorOutput,
    discoveryResult.segments,
    budgetWithSegments
  );
  reporter.updateAgent('bull', { status: 'ok', lastRun: new Date().toISOString() });
  reporter.updateAgent('bear', { status: 'ok', lastRun: new Date().toISOString() });

  // Persist bull/bear debate notes
  if (debateOutputs.length > 0) {
    const debateNotes = debateOutputs.flatMap((d) => [
      {
        ticker: d.ticker,
        noteType: 'bull',
        content: d.bull.technical_case,
        confidence: d.bull.conviction * 10,
        metadata: {
          upside_pct: d.bull.upside_pct,
          catalyst: d.bull.fundamental_catalyst,
          invalidation: d.bull.invalidation_condition,
        },
      },
      {
        ticker: d.ticker,
        noteType: 'bear',
        content: d.bear.technical_case,
        confidence: d.bear.conviction * 10,
        metadata: {
          downside_pct: d.bear.downside_pct,
          weakness: d.bear.structural_weakness,
          invalidation: d.bear.invalidation_condition,
        },
      },
    ]);
    await saveNotes(debateNotes).catch((err) => console.warn('[Orchestrator] Failed to save debate notes:', err));
  }

  // Step 8: Strategic decision
  reporter.updateAgent('strategist', { status: 'running' });
  const portfolio = await getPortfolioState(portfolioUsd);
  const heldTickers = portfolio.positions.map((p) => p.ticker);

  // Build swap candidates: positions held >= 2 days with pnl < +8%
  const swapCandidates: SwapCandidate[] = portfolio.positions
    .filter((p) => (p.days_held ?? 0) >= 2 && (p.pnlPct ?? 0) < 8)
    .map((p) => ({
      ticker: p.ticker,
      segment: discoveryResult.segments[p.ticker] ?? 'nasdaq',
      days_held: p.days_held ?? 0,
      entry_conviction: p.entry_conviction ?? 50,
      current_pnl_pct: p.pnlPct ?? 0,
      current_signal: 'HOLD',
    }));

  const strategist = new StrategistAgent();
  const orderProposals = await strategist.run(
    debateOutputs,
    portfolio,
    collectorOutput.market,
    heldTickers,
    budgetWithSegments,
    swapCandidates.length > 0 ? swapCandidates : undefined
  );
  reporter.updateAgent('strategist', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 8b: Inject relative weakness exits (deterministic, bypass LLM)
  const weakSells = generateWeaknessExits(portfolio.positions, collectorOutput.market.sector_biases);
  if (weakSells.length > 0) {
    console.log(`[Orchestrator] ${weakSells.length} vente(s) faiblesse relative injectée(s)`);
  }
  const allProposals = [...orderProposals, ...weakSells];

  // Step 9: Risk validation
  reporter.updateAgent('risk', { status: 'running' });
  const risk = new RiskAgent();
  const approvedOrders = await risk.run(
    allProposals,
    portfolioUsd,
    portfolio,
    collectorOutput.market,
    dailyLossLimitPct,
    collectorOutput.tickers,
  );
  reporter.updateAgent('risk', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 10: Execute orders
  const execResults = [];
  if (process.env.MOCK_BROKER !== 'false') {
    for (const order of approvedOrders) {
      try {
        const result = await executeOrder(order);
        execResults.push(result);
      } catch (err) {
        console.error(`[Orchestrator] Order execution failed for ${order.ticker}:`, err);
      }
    }
  }

  // Step 11: Report + AgentPrediction logging
  reporter.updateAgent('reporter', { status: 'running' });
  const finalPortfolio = await getPortfolioState(portfolioUsd);

  // Update equity peak for drawdown-from-peak tracking
  if (finalPortfolio.total_usd > 0) {
    await updateEquityPeak(finalPortfolio.total_usd);
  }

  await reporter.finalize(
    cycleStart,
    debateOutputs,
    execResults,
    portfolioUsd,
    dailyLossLimitPct,
    finalPortfolio,
    collectorOutput.market,
    discoveryResult.tickers
  );
  reporter.updateAgent('reporter', { status: 'ok', lastRun: new Date().toISOString() });

  const duration = Date.now() - cycleStart;
  console.log(`[Orchestrator] === CYCLE COMPLETE in ${duration}ms ===`);

  await prisma.cycleLog.create({
    data: {
      payload: { debateOutputs, execResults, finalPortfolio, market: collectorOutput.market } as any,
      ordersCount: execResults.length,
      alertsCount: 0,
      durationMs: duration,
    },
  });
}

export async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[Orchestrator] Pipeline already running, skipping cycle');
    return;
  }

  isRunning = true;
  const reporter = new ReporterAgent();

  try {
    await Promise.race([runPipelineInternal(reporter), cycleTimeout()]);
  } catch (err) {
    console.error('[Orchestrator] Cycle error:', err);
    reporter.updateAgent('reporter', { status: 'error', error: String(err) });

    const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
    const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
    const lossLimitRaw = await getCredential('daily_loss_limit_pct', 'DAILY_LOSS_LIMIT_PCT');
    const dailyLossLimitPct = parseFloat(lossLimitRaw || '3');
    await reporter.finalize(Date.now(), [], [], portfolioUsd, dailyLossLimitPct);
  } finally {
    isRunning = false;
  }
}
