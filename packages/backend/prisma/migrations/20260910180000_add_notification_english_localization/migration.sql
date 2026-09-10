-- Phase 2 notification localization. Purely additive: two nullable TEXT columns,
-- no default, no rename, no destructive statement, no change to any existing
-- column's type or nullability. Every existing notification row remains valid
-- with both new columns NULL, so this migration needs no backfill and rewrites
-- no historical data.
--
-- WHY TWO COLUMNS RATHER THAN ENCODING BOTH LANGUAGES IN title/body:
-- "notifications"."title" and "notifications"."body" are plain display text that
-- the shipped Desktop v3.6.5 client renders DIRECTLY to the user. Storing a
-- serialized structure (e.g. a JSON {"ar":...,"en":...} pair) in those columns
-- would be shown verbatim by that client during rollout. These columns keep
-- their existing plain-text contract permanently; English lives beside them.
--
-- Historical rows are intentionally left with NULL English text -- an older
-- Arabic notification legitimately stays Arabic, and the reader falls back to
-- the default-language columns.
ALTER TABLE "notifications" ADD COLUMN     "titleEn" TEXT,
ADD COLUMN     "bodyEn" TEXT;
