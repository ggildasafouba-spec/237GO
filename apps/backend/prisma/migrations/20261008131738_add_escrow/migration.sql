-- CreateEnum
CREATE TYPE "EscrowServiceType" AS ENUM ('RIDE', 'DELIVERY', 'CARPOOL', 'RENTAL', 'MARKET');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('HELD', 'RELEASED', 'REFUNDED', 'DISPUTED');

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "serviceType" "EscrowServiceType" NOT NULL,
    "serviceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'HELD',
    "clientConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "providerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "disputeReason" TEXT,
    "resolvedBy" TEXT,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escrows_serviceType_serviceId_idx" ON "escrows"("serviceType", "serviceId");

-- CreateIndex
CREATE INDEX "escrows_status_idx" ON "escrows"("status");

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
