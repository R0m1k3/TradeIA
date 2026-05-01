import { DiscoveryAgent } from './discovery';
import { CollectorAgent } from './collector';
import { AnalystAgent } from './analyst';
import { ResearcherAgent } from './researcher';
import { StrategistAgent } from './strategist';
import { RiskAgent } from './risk';
import { ReporterAgent } from './reporter';
import { executeOrder, getPortfolioState, markToMarket } from '../broker/mock';
import { prisma } from '../lib/prisma';
import { getCredential } from '../config/credentials';

const WATCHLIST_DEFAULT = (process.env.WATCHLIST || 'AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA,META,JPM,BAC,GE,AVGO,ORCL,CRM,AMD,QCOM,SBUX').split(',').map((t) => t.trim());

let isRunning = false;

export async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[Orchestrator] Pipeline already running, skipping cycle');
    return;
  }

  isRunning = true;
  const cycleStart = Date.now();

  // Dynamic Config retrieval
  const portfolioUsdRaw = await getCredential('portfolio_usd', 'PORTFOLIO_USD');
  const portfolioUsd = parseFloat(portfolioUsdRaw || '10000');
  const lossLimitRaw = await getCredential('daily_loss_limit_pct', 'DAILY_LOSS_LIMIT_PCT');
  const dailyLossLimitPct = parseFloat(lossLimitRaw || '3');

  console.log(`[Orchestrator] === CYCLE START (Capital: $${portfolioUsd}) ===`, new Date().toISOString());

  const reporter = new ReporterAgent();
  reporter.updateAgent('collector', { status: 'running' });

  try {
    // Step 1: Mark to market existing positions
    await markToMarket();

    // Step 2: Discovery (IA selects tickers)
    reporter.updateAgent('collector', { status: 'running' });
    const discovery = new DiscoveryAgent();
    let tickers = await discovery.run();
    
    if (tickers.length === 0) {
      console.log('[Orchestrator] Discovery returned nothing, using fallback watchlist');
      tickers = WATCHLIST_DEFAULT;
    }

    // Step 3: Collect data
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

    // Step 4: Technical analysis
    reporter.updateAgent('analyst', { status: 'running' });
    const analyst = new AnalystAgent();
    const analystOutputs = await analyst.run(collectorOutput);
    reporter.updateAgent('analyst', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 5: Bull/Bear debate (parallel)
    reporter.updateAgent('bull', { status: 'running' });
    reporter.updateAgent('bear', { status: 'running' });
    const researcher = new ResearcherAgent();
    const debateOutputs = await researcher.run(analystOutputs, collectorOutput);
    reporter.updateAgent('bull', { status: 'ok', lastRun: new Date().toISOString() });
    reporter.updateAgent('bear', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 6: Strategic decision
    reporter.updateAgent('strategist', { status: 'running' });
    const portfolio = await getPortfolioState(portfolioUsd);
    const heldTickers = portfolio.positions.map((p) => p.ticker);

    const strategist = new StrategistAgent();
    const orderProposals = await strategist.run(debateOutputs, portfolio, collectorOutput.market, heldTickers);
    reporter.updateAgent('strategist', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 7: Risk validation
    reporter.updateAgent('risk', { status: 'running' });
    const risk = new RiskAgent();
    const approvedOrders = await risk.run(orderProposals, portfolioUsd, portfolio, collectorOutput.market, dailyLossLimitPct);
    reporter.updateAgent('risk', { status: 'ok', lastRun: new Date().toISOString() });

    // Step 8: Execute orders
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

    // Step 9: Report
    reporter.updateAgent('reporter', { status: 'running' });
    const finalPortfolio = await getPortfolioState(portfolioUsd);
    await reporter.finalize(cycleStart, debateOutputs, execResults, portfolioUsd, dailyLossLimitPct, finalPortfolio, collectorOutput.market);
    reporter.updateAgent('reporter', { status: 'ok', lastRun: new Date().toISOString() });

    const duration = Date.now() - cycleStart;
    console.log(`[Orchestrator] === CYCLE COMPLETE in ${duration}ms ===`);

    // Persist cycle log
    await prisma.cycleLog.create({
      data: {
        payload: { debateOutputs, execResults, finalPortfolio } as any,
        ordersCount: execResults.length,
        alertsCount: 0,
        durationMs: duration,
      },
    });
  } catch (err) {
    console.error('[Orchestrator] Cycle error:', err);
    reporter.updateAgent('reporter', { status: 'error', error: String(err) });
    await reporter.finalize(cycleStart, [], [], portfolioUsd, dailyLossLimitPct);
  } finally {
    isRunning = false;
  }
}
