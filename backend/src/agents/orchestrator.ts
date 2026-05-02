import { DiscoveryAgent } from './discovery';
import { CollectorAgent } from './collector';
import { AnalystAgent } from './analyst';
import { ResearcherAgent } from './researcher';
import { StrategistAgent } from './strategist';
import { RiskAgent } from './risk';
import { ReporterAgent } from './reporter';
import { executeOrder, getPortfolioState, markToMarket, closeTrade } from '../broker/mock';
import { prisma } from '../lib/prisma';
import { getCredential } from '../config/credentials';
import { broadcastAlert } from '../websocket';

const WATCHLIST_DEFAULT = (process.env.WATCHLIST || 'AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,AVGO,ORCL,ADBE,CRM,INTC,AMD,QCOM,TXN,SBUX,PYPL,BKNG,ISRG,MDLZ,ADP,GILD,VRTX,REGN,MNST,CHTR,LRCX,KLAC,MRVL,PANW,SNPS,CDNS,MRNA,ILMN,BIIB,FTNT,ZS,DDOG,NET,CRWD,ABNB,COIN,PLTR,ARM,GE,COST,CMCSA,NFLX,PEP').split(',').map((t) => t.trim());

const CYCLE_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes max par cycle

let isRunning = false;

function cycleTimeout(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Cycle timeout after 8 minutes')), CYCLE_TIMEOUT_MS)
  );
}

async function checkCircuitBreaker(
  portfolioUsd: number,
  maxDrawdownPct: number,
  reporter: ReporterAgent
): Promise<boolean> {
  const portfolio = await getPortfolioState(portfolioUsd);
  const drawdownPct = ((portfolio.initial_capital - portfolio.total_usd) / portfolio.initial_capital) * 100;

  if (drawdownPct >= maxDrawdownPct) {
    console.error(`[Orchestrator] CIRCUIT BREAKER: drawdown ${drawdownPct.toFixed(2)}% >= ${maxDrawdownPct}%`);

    // Fermer toutes les positions ouvertes
    const openTrades = await prisma.trade.findMany({ where: { closedAt: null, action: 'BUY' } });
    for (const trade of openTrades) {
      await closeTrade(trade.id, trade.filledPrice, 'CIRCUIT_BREAKER');
    }

    // Pause forcée de 72h via config
    await prisma.config.upsert({
      where: { key: 'paused' },
      update: { value: 'true' },
      create: { key: 'paused', value: 'true' },
    });
    await prisma.config.upsert({
      where: { key: 'circuit_breaker_triggered_at' },
      update: { value: new Date().toISOString() },
      create: { key: 'circuit_breaker_triggered_at', value: new Date().toISOString() },
    });

    broadcastAlert('critical',
      `🚨 CIRCUIT BREAKER DÉCLENCHÉ — Drawdown ${drawdownPct.toFixed(2)}% — ${openTrades.length} positions fermées — Trading suspendu`
    );

    reporter.updateAgent('reporter', { status: 'error', error: 'Circuit breaker triggered' });
    return true; // déclenché
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

  // Step 3: Discovery
  reporter.updateAgent('collector', { status: 'running' });
  const discovery = new DiscoveryAgent();
  let tickers = await discovery.run();

  if (tickers.length === 0) {
    console.log('[Orchestrator] Discovery returned nothing, using fallback watchlist');
    tickers = WATCHLIST_DEFAULT;
  }

  // Limit tickers per cycle to avoid timeout with slow LLM calls
  if (tickers.length > 8) {
    const held = (await getPortfolioState(portfolioUsd)).positions.map((p) => p.ticker);
    // Prioritize held positions, then fill up to 8
    const prioritized = [...held.filter((t) => tickers.includes(t))];
    const remaining = tickers.filter((t) => !prioritized.includes(t));
    tickers = [...prioritized, ...remaining].slice(0, 8);
    console.log(`[Orchestrator] Limiting to ${tickers.length} tickers: ${tickers.join(', ')}`);
  }

  // Step 4: Collect data
  const collector = new CollectorAgent();
  const collectorOutput = await collector.run(tickers);
  reporter.updateAgent('collector', {
    status: collectorOutput ? 'ok' : 'error',
    lastRun: new Date().toISOString(),
  });

  if (!collectorOutput) {
    console.error('[Orchestrator] Collector failed, aborting cycle');
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
    return;
  }

  // Step 5: Technical analysis
  reporter.updateAgent('analyst', { status: 'running' });
  const analyst = new AnalystAgent();
  const analystOutputs = await analyst.run(collectorOutput);
  reporter.updateAgent('analyst', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 6: Bull/Bear debate
  reporter.updateAgent('bull', { status: 'running' });
  reporter.updateAgent('bear', { status: 'running' });
  const researcher = new ResearcherAgent();
  const debateOutputs = await researcher.run(analystOutputs, collectorOutput);
  reporter.updateAgent('bull', { status: 'ok', lastRun: new Date().toISOString() });
  reporter.updateAgent('bear', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 7: Strategic decision
  reporter.updateAgent('strategist', { status: 'running' });
  const portfolio = await getPortfolioState(portfolioUsd);
  const heldTickers = portfolio.positions.map((p) => p.ticker);

  const strategist = new StrategistAgent();
  const orderProposals = await strategist.run(debateOutputs, portfolio, collectorOutput.market, heldTickers);
  reporter.updateAgent('strategist', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 8: Risk validation
  reporter.updateAgent('risk', { status: 'running' });
  const risk = new RiskAgent();
  const approvedOrders = await risk.run(
    orderProposals,
    portfolioUsd,
    portfolio,
    collectorOutput.market,
    dailyLossLimitPct,
    collectorOutput.tickers
  );
  reporter.updateAgent('risk', { status: 'ok', lastRun: new Date().toISOString() });

  // Step 9: Execute orders
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

  // Step 10: Report + AgentPrediction logging
  reporter.updateAgent('reporter', { status: 'running' });
  const finalPortfolio = await getPortfolioState(portfolioUsd);
  await reporter.finalize(
    cycleStart,
    debateOutputs,
    execResults,
    portfolioUsd,
    dailyLossLimitPct,
    finalPortfolio,
    collectorOutput.market,
    tickers
  );
  reporter.updateAgent('reporter', { status: 'ok', lastRun: new Date().toISOString() });

  const duration = Date.now() - cycleStart;
  console.log(`[Orchestrator] === CYCLE COMPLETE in ${duration}ms ===`);

  await prisma.cycleLog.create({
    data: {
      payload: { debateOutputs, execResults, finalPortfolio } as any,
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
