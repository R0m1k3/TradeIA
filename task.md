## Context
The user feels the list of tickers proposed to the AI is too weak/limited, especially when falling back to the NASDAQ 100 list (which was previously truncated to the first 15 alphabetically). The user wants the AI to be able to pick from the entire NASDAQ.

## Current Focus
Update the `Discovery` agent so that when it falls back to the NASDAQ list, it passes the entire `NASDAQ_100` (or asks the LLM to freely pick 15-20 tickers from the NASDAQ) instead of rigidly slicing the first 15 alphabetically. We will ask the Discovery LLM to select the tickers from the full NASDAQ 100 list.

## Master Plan
- [x] Modify `discovery.ts` to use the `Discovery` LLM to pick 15 tickers from the full `NASDAQ_100` list when falling back, instead of `.slice(0, 15)`.
- [x] Apply the same LLM selection logic to the Yahoo screener results to ensure the AI always decides which tickers to analyze.

## Progress Log
- Added plan to expand discovery ticker selection using AI.
- Restored LLM logic in `analyst.ts`.
- Increased Orchestrator timeout to 60 minutes to safely allow all AI agents to process sequentially/in queues.
- Updated `discovery.ts` to use a helper function `selectWithAI` to let the AI LLM pick from Yahoo and NASDAQ results, rather than defaulting to static slices.
