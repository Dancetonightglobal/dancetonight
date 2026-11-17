-- D-077: every stored Google place ID is asked once more by the new check (the venue's name alone,
-- searched near its point with a bias, not inside the 200 m box). Data only; no column changes.
UPDATE "venues" SET "google_place_name_checked_at" = NULL WHERE "google_place_id" IS NOT NULL;
