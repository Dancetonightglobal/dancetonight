-- D-121: a venue's whole calendar carries D-083's screen in the sources table, so a calendar that
-- discovery finds can carry it too (it was keyed by starting address in config/sources only).
ALTER TABLE "sources" ADD COLUMN "mixed_calendar" boolean DEFAULT false NOT NULL;
