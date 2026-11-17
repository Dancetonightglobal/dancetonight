-- #977 cleans the word joiner (U+2060) and object replacement character (U+FFFC) out of new venue names;
-- a venue stored before keeps its name, because a later read matches the stored row. Data only; no column changes.
UPDATE "venues" SET "name" = btrim(regexp_replace("name", U&'[\2060\FFFC]', '', 'g')) WHERE "name" ~ U&'[\2060\FFFC]';
