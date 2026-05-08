-- Add TickerSnapshot, TickerNote, PreMarketPrep tables

CREATE TABLE "TickerSnapshot" (
    "id"         TEXT NOT NULL,
    "ticker"     TEXT NOT NULL,
    "interval"   TEXT NOT NULL,
    "time"       TIMESTAMP(3) NOT NULL,
    "open"       DOUBLE PRECISION NOT NULL,
    "high"       DOUBLE PRECISION NOT NULL,
    "low"        DOUBLE PRECISION NOT NULL,
    "close"      DOUBLE PRECISION NOT NULL,
    "volume"     DOUBLE PRECISION,
    "source"     TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickerSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TickerSnapshot_ticker_time_idx" ON "TickerSnapshot"("ticker", "time");
CREATE INDEX "TickerSnapshot_ticker_interval_time_idx" ON "TickerSnapshot"("ticker", "interval", "time");

CREATE TABLE "TickerNote" (
    "id"         TEXT NOT NULL,
    "ticker"     TEXT NOT NULL,
    "noteType"   TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "confidence" INTEGER,
    "cycleId"    TEXT,
    "metadata"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickerNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TickerNote_ticker_noteType_createdAt_idx" ON "TickerNote"("ticker", "noteType", "createdAt");
CREATE INDEX "TickerNote_createdAt_idx" ON "TickerNote"("createdAt");

CREATE TABLE "PreMarketPrep" (
    "id"              TEXT NOT NULL,
    "date"            TEXT NOT NULL,
    "ticker"          TEXT NOT NULL,
    "closePrev"       DOUBLE PRECISION NOT NULL,
    "vixPrev"         DOUBLE PRECISION,
    "macroSummary"    TEXT,
    "setupSignal"     TEXT NOT NULL,
    "confidence"      INTEGER NOT NULL,
    "reasoning"       TEXT NOT NULL,
    "executedAtOpen"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreMarketPrep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PreMarketPrep_date_ticker_idx" ON "PreMarketPrep"("date", "ticker");
CREATE INDEX "PreMarketPrep_date_setupSignal_idx" ON "PreMarketPrep"("date", "setupSignal");
