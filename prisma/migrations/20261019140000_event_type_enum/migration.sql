/*
  Event types become a closed set.

  `Event.eventType` was free text, so the same concept was spelled "biye",
  "Wedding Reception" or "Photography" depending on who typed it. The public
  events board, the header menu and every filter need one canonical list, so
  the column becomes the `EventType` enum.

  Existing rows are mapped onto the enum by their (lower-cased, trimmed) text.
  Anything that does not match a known type becomes OTHER — the old value is
  not lost, it is the only sane default for a free-text column.
*/

-- CreateEnum
CREATE TYPE "EventType" AS ENUM (
    'WEDDING',
    'WEDDING_RECEPTION',
    'BIRTHDAY',
    'ANNIVERSARY',
    'CORPORATE',
    'CONFERENCE',
    'CONCERT',
    'FESTIVAL',
    'EXHIBITION',
    'SPORTS',
    'OTHER'
);

-- Map the free text values onto the enum, then swap the column over.
ALTER TABLE "Event"
ADD COLUMN "eventTypeNew" "EventType";

UPDATE "Event"
SET "eventTypeNew" = CASE
    WHEN lower(trim("eventType")) = 'wedding' THEN 'WEDDING'::"EventType"
    WHEN lower(trim("eventType")) = 'wedding reception' THEN 'WEDDING_RECEPTION'::"EventType"
    WHEN lower(trim("eventType")) = 'birthday' THEN 'BIRTHDAY'::"EventType"
    WHEN lower(trim("eventType")) = 'anniversary' THEN 'ANNIVERSARY'::"EventType"
    WHEN lower(trim("eventType")) = 'corporate' THEN 'CORPORATE'::"EventType"
    WHEN lower(trim("eventType")) = 'conference' THEN 'CONFERENCE'::"EventType"
    WHEN lower(trim("eventType")) = 'concert' THEN 'CONCERT'::"EventType"
    WHEN lower(trim("eventType")) = 'festival' THEN 'FESTIVAL'::"EventType"
    WHEN lower(trim("eventType")) = 'exhibition' THEN 'EXHIBITION'::"EventType"
    WHEN lower(trim("eventType")) = 'sports' THEN 'SPORTS'::"EventType"
    ELSE 'OTHER'::"EventType"
END
WHERE "eventType" IS NOT NULL;

UPDATE "Event"
SET "eventTypeNew" = 'OTHER'::"EventType"
WHERE "eventTypeNew" IS NULL;

ALTER TABLE "Event" DROP COLUMN "eventType";
ALTER TABLE "Event" RENAME COLUMN "eventTypeNew" TO "eventType";
ALTER TABLE "Event" ALTER COLUMN "eventType" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "eventType" SET DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "Event_eventType_idx" ON "Event"("eventType");
