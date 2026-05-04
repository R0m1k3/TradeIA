# Task Plan: Resolve Market Data & Simulation Issues

## Context
The application is failing to receive market data properly. We are seeing HTTP 403 (Forbidden) and HTTP 429 (Too Many Requests) from Polygon API. Yahoo trending discovery is returning empty.
Moreover, LLM calls (Analyst) are timing out after 180 seconds, and the Orchestrator cycle is timing out after 8 minutes, which means no trades are happening and the simulation doesn't work.

## Current Focus
Investigate Polygon API errors, Yahoo discovery fallback, and LLM timeouts. Create robust error handling or fallback mechanisms to ensure the trading simulation can function even if some APIs hit limits.

## Master Plan
- [x] Investigate Polygon API calls in `backend` and see why 403 and 429 are happening (could be free tier limits, maybe need a sleep/delay or fallback).
- [x] Investigate `Yahoo finance screener` to see why it returns nothing.
- [x] Investigate LLM timeout issue (180s timeout exceeded for `analyst`).
- [x] Fix Yahoo discovery fallback by removing the unapplicable filter.
- [x] Fix Analyst timeout by returning deterministic results without parallel LLM calls when indicators are present.
- [x] Increase Orchestrator cycle timeout from 8 minutes to 30 minutes.

## Progress Log
- Created task.md
- Investigated and found Yahoo filter bug in `discovery.ts`.
- Investigated and found Analyst redundant parallel LLM calls causing 180s timeouts in `analyst.ts`.
- Investigated and found Orchestrator cycle timeout too short for LLM queues in `orchestrator.ts`.
- Fixed Yahoo finance parsing by extracting just the ticker symbols.
- Removed parallel LLM call in Analyst when indicators are available, defaulting to fast deterministic logic.
- Increased Orchestrator timeout limit to 30 minutes.
