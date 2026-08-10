-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "previousServiceDate" TIMESTAMP(3),
ADD COLUMN     "previousServiceNote" TEXT,
ADD COLUMN     "previousServiceType" TEXT;
