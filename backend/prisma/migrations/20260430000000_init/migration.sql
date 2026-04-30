-- CreateTable
CREATE TABLE "Config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tradeType" TEXT NOT NULL,
    "filledPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "sizeUsd" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit" DOUBLE PRECISION NOT NULL,
    "invalidationCondition" TEXT,
    "confidence" INTEGER NOT NULL,
    "debateScore" INTEGER NOT NULL,
    "bullConviction" INTEGER NOT NULL,
    "bearConviction" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "mock" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "closePrice" DOUBLE PRECISION,
    "pnlUsd" DOUBLE PRECISION,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleLog" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ordersCount" INTEGER NOT NULL,
    "alertsCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleLog_pkey" PRIMARY KEY ("id")
);
