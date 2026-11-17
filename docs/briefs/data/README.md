# Baseline data for the lanes

Scraped from the live site (https://dancetonight.vercel.app, public) and from the pages our sources serve, by the integrator on 2026-09-29. No lane has the production database, so this is what "the live rows" means in the briefs. It is a snapshot, not the current site: read the live site yourself when you need today's rows (it is our own site; keep to a sensible pace).

| File | What it is |
|---|---|
| `run33-rows.json` | The 83 listings the site showed after ingest run 33. One entry per event page: slug, night, title, family, the time line, the venue lines, organizer lines, source hosts, map point and JSON-LD. |
| `run33-facts.json` | The same 83 listings' facts as their event pages print them: cost lines and the facts block (level, partner, age, floor, music, dress code, crowd). |
| `run34-cards.json` | The home page's cards night by night (9/29 to 10/11) after run 34, with each card's source host and lines. This is the coverage baseline: 84 listings over 13 nights. |
| `pages-run33/*.txt` | The cleaned text (`src/pipeline/clean.ts`) of 15 model-read source pages as run 33 fetched them. |

Measure a change by replaying these through your code. The integrator re-measures on production after the merge.
