-- Modification #6: adds one optional, non-financial text column so a technician
-- can record a note for the customer's NEXT maintenance visit at completion time.
-- Additive only; nullable (no default needed -- existing rows simply have no
-- note, which is exactly their current, unchanged state). No other schema
-- changes; no data is deleted or transformed.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "nextMaintenanceNote" TEXT;
