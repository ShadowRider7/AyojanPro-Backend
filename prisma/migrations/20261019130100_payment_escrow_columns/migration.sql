/*
  Escrow bookkeeping: when the money was released to the professional and
  which payment status a failed refund has to fall back to.
*/

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "originalStatus" "PaymentStatus" NOT NULL DEFAULT 'ESCROWED';
