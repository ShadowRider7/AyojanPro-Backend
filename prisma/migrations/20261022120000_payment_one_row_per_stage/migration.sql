/*
  A contract has TWO payments: the 30% advance (INITIAL) and the 70% final
  payment (FINAL). Both of them are held by the platform until the contract is
  completed, so they need their own rows — "only one payment per (contract,
  stage)" (requirements doc §15).

  The unique index on `contractId` alone forced both stages into a single
  row, which broke the retry of a failed final payment:

    • initiating the final payment overwrote the escrowed advance,
    • a failed final payment had to be "reverted" back to the advance, which
      threw the attempt away and left the contract stuck,
    • the retry re-used the merchant invoice number of the previous attempt,
      which bKash rejects as a duplicate (2029/2031), and the create response
      was never checked — so the row was left in PENDING and the next attempt
      was told "the initial payment must be settled first".
*/

-- DropIndex
DROP INDEX "Payment_contractId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Payment_contractId_stage_key" ON "Payment"("contractId", "stage");

/*
  Repair the rows the single-row design left behind.

  `Contract.confirmedAt` is only stamped when the 30% advance is actually
  captured, so it is the proof that the money really sits in the escrow. A
  payment row of such a contract that is not in a settled state was either
  overwritten by the final payment or degraded by the revert — it is put back
  into the escrow as the advance it really is, so the final payment can be
  retried.

  The stale checkout session (`bkashPaymentId`) of the abandoned attempt is
  cleared, so a late callback of that attempt can never settle the row as the
  wrong stage. The transaction id of the captured advance is kept — it is the
  trail the refund needs.
*/
UPDATE "Payment" p
SET "status" = 'ESCROWED',
    "stage" = 'INITIAL',
    "amount" = ROUND(c."agreedAmount" * 0.30, 2),
    "bkashPaymentId" = NULL,
    "failureReason" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Contract" c
WHERE c.id = p."contractId"
  AND c."confirmedAt" IS NOT NULL
  AND c.status IN ('CONFIRMED', 'IN_PROGRESS', 'DELIVERED', 'DISPUTED', 'RESOLVED')
  AND p.status IN ('PENDING', 'PROCESSING', 'FAILED', 'CANCELLED');

/*
  A completed contract releases its escrow — if the row is still escrowed it
  was never released to the professional.
*/
UPDATE "Payment" p
SET "status" = 'COMPLETED',
    "releasedAt" = COALESCE(p."releasedAt", c."completedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Contract" c
WHERE c.id = p."contractId"
  AND c.status = 'COMPLETED'
  AND p.status = 'ESCROWED';
