/*
  The platform holds the client's money in escrow until the contract is
  completed. A captured payment that is not released yet is ESCROWED.

  This is its own migration because a new enum value cannot be used in the
  same transaction that adds it.
*/

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'ESCROWED';
