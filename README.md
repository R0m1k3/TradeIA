# NEXUS TRADE — Autonomous AI Trading Terminal

A full-stack, containerized autonomous trading system powered by a multi-agent AI pipeline. Features a Bloomberg-style dark terminal UI, real-time WebSocket updates, and a bull/bear debate architecture for decision-making.

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- An external nginx reverse proxy running with the `nginx_default` network
- 4 GB RAM minimum (8 GB recommended)
- API keys for OpenRouter + at least one market data provider

> **Note:** This stack does **not** include its own nginx. It attaches to an existing `nginx_default` external Docker network so that your reverse proxy can route traffic to the `frontend` (port 80) and `backend` (port 4000) containers.

---

## Quick Start (3 commands)

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set OPENROUTER_API_KEY and DOMAIN at minimum

# 2. Start all services
docker compose up -d

# 3. Configure your reverse proxy to route:
#    /api  and  /ws  → backend:4000
#    /           → frontend:80
```

---

## Network Architecture

This stack expects an **external** Docker network named `nginx_default` (created by your existing nginx proxy stack):

```bash
# Verify the network exists
docker network ls | grep nginx_default

# If it does not exist yet
docker network create nginx_default
```

Your reverse proxy should forward:

| Path | Target container | Port |
|---|---|---|
| `/api/*` | `backend` | 4000 |
| `/ws` (WebSocket) | `backend` | 4000 |
| `/` | `frontend` | 80 |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DOMAIN` | No | Your domain/IP for WS & API URLs (default: `localhost`) |
| `LLM_PROVIDER` | No | `openrouter` (default) or `ollama` |
| `OPENROUTER_API_KEY` | Yes* | OpenRouter API key (*if using cloud) |
| `OLLAMA_BASE_URL` | No | Ollama endpoint (default: http://ollama:11434) |
| `MODEL_LIGHT` | No | Model for collector/reporter agents |
| `MODEL_MID` | No | Model for analyst/researcher agents |
| `MODEL_STRONG` | No | Model for strategist/risk agents |
| `ALPHA_VANTAGE_KEY` | Recommended | Market OHLCV + fundamentals data |
| `POLYGON_KEY` | Optional | Options data (put/call ratio, IV30) |
| `FINNHUB_KEY` | Optional | News sentiment data |
| `MOCK_BROKER` | No | `true` = simulated trades (default), `false` = real |
| `PORTFOLIO_USD` | No | Starting portfolio size (default: 10000) |
| `DAILY_LOSS_LIMIT_PCT` | No | Daily loss limit % (default: 3) |
| `WATCHLIST` | No | Comma-separated tickers (default: AAPL,MSFT,...) |
| `DB_PASS` | No | PostgreSQL password (default: trading123) |
| `ADMIN_PASSWORD` | Yes | Password for override API endpoints |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `openrouter` (default) or `ollama` |
| `OPENROUTER_API_KEY` | Yes* | OpenRouter API key (*if using cloud) |
| `OLLAMA_BASE_URL` | No | Ollama endpoint (default: http://ollama:11434) |
| `MODEL_LIGHT` | No | Model for collector/reporter agents |
| `MODEL_MID` | No | Model for analyst/researcher agents |
| `MODEL_STRONG` | No | Model for strategist/risk agents |
| `ALPHA_VANTAGE_KEY` | Recommended | Market OHLCV + fundamentals data |
| `POLYGON_KEY` | Optional | Options data (put/call ratio, IV30) |
| `FINNHUB_KEY` | Optional | News sentiment data |
| `MOCK_BROKER` | No | `true` = simulated trades (default), `false` = real |
| `PORTFOLIO_USD` | No | Starting portfolio size (default: 10000) |
| `DAILY_LOSS_LIMIT_PCT` | No | Daily loss limit % (default: 3) |
| `WATCHLIST` | No | Comma-separated tickers (default: AAPL,MSFT,...) |
| `DB_PASS` | No | PostgreSQL password (default: trading123) |
| `ADMIN_PASSWORD` | Yes | Password for override API endpoints |

---

## Agent Pipeline

```
Every 5 minutes:
  1. Collector    → Fetch OHLCV (15m/1h/4h), fundamentals, news, options
  2. Analyst      → Multi-timeframe technical analysis (EMA, RSI, MACD, ATR)
  3. Researcher   → Bull + Bear debate in parallel (conviction scoring 1-10)
  4. Strategist   → Synthesize debate → order proposals
  5. Risk Manager → Validate sizing, R/R, VIX regime, sector concentration
  6. Mock Broker  → Execute approved orders with simulated slippage
  7. Reporter     → WebSocket broadcast to all connected frontends
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | System health check |
| GET | `/api/portfolio` | Current portfolio state |
| GET | `/api/portfolio/trades` | Open positions |
| GET | `/api/portfolio/history` | Closed trade history |
| GET | `/api/signals` | Latest agent signals |
| GET | `/api/config` | Current configuration |
| POST | `/api/config` | Update configuration |
| POST | `/api/override/pause` | Pause trading (requires ADMIN_PASSWORD) |
| POST | `/api/override/resume` | Resume trading |
| POST | `/api/override/close/:ticker` | Force close position |
| POST | `/api/override/block/:ticker` | Block ticker from trading |

Override endpoints require HTTP Basic Auth: `Authorization: Basic base64(:ADMIN_PASSWORD)`

---

## Architecture

```
[External nginx reverse proxy]  (nginx_default network)
  ├── /        → frontend:80   (React + Vite static)
  ├── /api     → backend:4000  (Fastify REST API)
  └── /ws      → backend:4000  (WebSocket upgrades)

[Internal network]
  backend ──→ postgres:5432  (TimescaleDB)
  backend ──→ redis:6379     (BullMQ + cache)
  backend ──→ ollama:11434   (optional local LLM)

backend
  ├── BullMQ   → Job queue (Redis)
  ├── Prisma   → ORM (PostgreSQL + TimescaleDB)
  └── Agents   → LLM pipeline (OpenRouter / Ollama)
```

---

## Local GPU (Ollama)

```bash
# Start with GPU support
docker compose --profile gpu up -d

# Pull a model
docker exec -it $(docker compose ps -q ollama) ollama pull qwen2.5:14b

# Switch to Ollama in .env
LLM_PROVIDER=ollama
MODEL_LIGHT=qwen2.5:7b
MODEL_MID=qwen2.5:14b
MODEL_STRONG=qwen2.5:32b
```

---

## Development (hot-reload)

The `docker-compose.override.yml` is automatically loaded in dev:

```bash
docker compose up -d
# Frontend hot-reload: http://localhost:5173
# Backend auto-restart on file changes
```

---

## Risk Disclaimer

This system is for educational and research purposes only. The `MOCK_BROKER=true` default ensures no real money is at risk. Set `MOCK_BROKER=false` only if you have connected a real broker and understand the risks of automated trading.
