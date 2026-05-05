## Context
The user wants to investigate why the AI agents in the TradeIA application are not executing buy orders for cryptocurrencies.

## Current Focus
Proposing and implementing the fixes for the Risk Agent limits and Broker price updates.

## Master Plan
- [x] 1. Search the codebase for agent decision logic (prompts, parsers, executors).
- [x] 2. Analyze the `binance.ts` or relevant execution module for order placement.
- [x] 3. Analyze the data collection/filtering for crypto to ensure it's reaching the agents.
- [x] 4. Identify the bug or restriction preventing crypto buys.
- [x] 5. Create an implementation plan to present the findings to the user.
- [x] 6. Fix `mock.ts` to use `getBinanceCurrentPrice` for Crypto.
- [x] 7. Fix `risk.ts` to exempt Crypto from the 3-position sector limit (since it has its own capital cap).

## Progress Log
- Started investigation on crypto buying issue.
- Identified that `mock.ts` fails to fetch current crypto prices, permanently locking open crypto trades.
- Identified that `risk.ts` categorizes Crypto as "Autre" and blocks buys after 3 positions.
- Execution complete: Fixed price fetch and risk logic for Cryptocurrencies.
