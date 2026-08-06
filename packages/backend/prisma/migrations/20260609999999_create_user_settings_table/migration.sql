-- Corrective migration: "user_settings" has historically been created ONLY by the
-- backend's runtime startup code (packages/backend/src/index.ts -> ensureUserSettingsTable(),
-- plus four color columns added by ensureSchemaUpdates()), never by a Prisma migration.
-- The next migration (20260610000000_feature_expansion) ALTERs this table assuming it
-- already exists, which fails on a completely fresh database. This migration creates it
-- first, with the exact columns/defaults/nullability the runtime code and
-- packages/backend/src/routes/settings.ts already rely on. Guarded with IF NOT EXISTS
-- throughout, so it is also a safe no-op wherever the table already exists (e.g.
-- production, created via the runtime path).

CREATE TABLE IF NOT EXISTS "user_settings" (
    "id"                   TEXT         NOT NULL,
    "userId"               TEXT         NOT NULL,
    "theme"                TEXT         NOT NULL DEFAULT 'light',
    "fontSize"             TEXT         NOT NULL DEFAULT 'medium',
    "interfaceScale"       TEXT         NOT NULL DEFAULT 'normal',
    "background"           TEXT         NOT NULL DEFAULT 'day',
    "highContrast"         BOOLEAN      NOT NULL DEFAULT false,
    "improvedReadability"  BOOLEAN      NOT NULL DEFAULT false,
    "notificationsEnabled" BOOLEAN      NOT NULL DEFAULT true,
    "soundEnabled"         BOOLEAN      NOT NULL DEFAULT true,
    "soundVolume"          INTEGER      NOT NULL DEFAULT 70,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_userId_key" ON "user_settings"("userId");

-- Color columns: added separately by ensureSchemaUpdates() in the runtime path, nullable
-- with no database-level default (packages/backend/src/routes/settings.ts applies the
-- '#1E6FFF' / '#0F1B2D' / '#1E6FFF' / '#FFFFFF' defaults itself, at the application layer,
-- via COALESCE on insert) -- preserved exactly as-is, not tightened to NOT NULL here.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "secondaryColor" TEXT;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "buttonColor" TEXT;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "cardColor" TEXT;
