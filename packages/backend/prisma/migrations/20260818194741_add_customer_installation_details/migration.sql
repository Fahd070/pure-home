-- Optional installation-details section (Admin + Scheduling), Part 1 of the
-- customer-installation-and-activity-fix feature. Purely additive, nullable
-- columns -- no default that changes the meaning of any existing row, no
-- rename, no destructive statement. Every existing customer remains valid
-- with all three new columns NULL.
--
-- Deliberately separate from `customers.notes` (general notes) and from
-- Appointment.completionAmount/completionPaymentMethod (per-appointment
-- completion financials) -- see the field comments in schema.prisma.
--
-- installationPaymentMethod is a plain nullable TEXT tag validated at the API
-- layer (CASH / BANK_CARD_PERSONAL / BANK_CARD_COMMERCIAL), matching this
-- schema's existing convention for previousServiceType and
-- Appointment.completionPaymentMethod rather than a dedicated Postgres enum
-- for three optional values.
ALTER TABLE "customers" ADD COLUMN     "installationAmount" DOUBLE PRECISION,
ADD COLUMN     "installationNote" TEXT,
ADD COLUMN     "installationPaymentMethod" TEXT;
