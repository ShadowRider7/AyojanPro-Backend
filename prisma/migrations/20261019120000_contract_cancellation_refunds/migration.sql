/*
  Contract cancellation policy + refund trail.

  A professional may only cancel a contract while the service is still at
  least 48 hours away, and a contract cancelled by the professional (or by an
  admin) refunds the client the money that was already captured. The `Refund`
  table is the audit trail for that money coming back to the client.
*/

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "cancelledByRole" "Role",
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundIssuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundReference" VARCHAR(255),
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'BDT',
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(255),
    "note" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_paymentId_key" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "Refund_contractId_idx" ON "Refund"("contractId");

-- CreateIndex
CREATE INDEX "Refund_clientId_idx" ON "Refund"("clientId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
