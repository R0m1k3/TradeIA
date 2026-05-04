## Context
The user wants to analyze the entire NASDAQ 100 + Crypto market per cycle (120 tickers) and replace all broken/limited APIs with 100% free and unmetered alternatives (Binance, TradingView, Finviz, Yahoo).

## Current Focus
Execution of the Global Market API Cleanup & Integration Plan.

## Master Plan
- [x] 1. Delete broken APIs (`polygon.ts`, `alphavantage.ts`, `finnhub.ts`, `twitter.ts`, `stocktwits.ts`).
- [x] 2. Create `tradingview.ts` for technical signals.
- [x] 3. Create `binance.ts` for crypto OHLCV.
- [x] 4. Create `finviz.ts` for macro market sentiment.
- [x] 5. Update `yahoo.ts` to be the sole US stock provider.
- [x] 6. Update `discovery.ts` to fetch and return the 120 combined tickers.
- [x] 7. Update `collector.ts` to use the new sources efficiently.
- [x] 8. Update `orchestrator.ts` timeout to 4 hours.
- [x] 9. Update prompts (Analyst) to use TV signals and drop social APIs.
- [x] 10. Update frontend (remove social/API config, add crypto support if needed).

## Progress Log
- Plan approved by user.
- Updated `task.md` to begin execution.
