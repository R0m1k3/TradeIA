-- Migration: add AgentPrediction table for AI feedback loop

CREATE TABLE "AgentPrediction" (
    "id"                 TEXT NOT NULL,
    "cycleId"            TEXT NOT NULL,
    "ticker"             TEXT NOT NULL,
    "predictedDirection" TEXT NOT NULL,
    "confidence"         INTEGER NOT NULL,
    "debateScore"        INTEGER NOT NULL,
    "bullConviction"     INTEGER NOT NULL,
    "bearConviction"     INTEGER NOT NULL,
    "priceAtPrediction"  DOUBLE PRECISION NOT NULL,
    "actualReturn5d"     DOUBLE PRECISION,
    "correct"            BOOLEAN,
    "resolvedAt"         TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPrediction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentPrediction_ticker_idx" ON "AgentPrediction"("ticker");
CREATE INDEX "AgentPrediction_createdAt_idx" ON "AgentPrediction"("createdAt");
CREATE INDEX "AgentPrediction_resolvedAt_idx" ON "AgentPrediction"("resolvedAt");
