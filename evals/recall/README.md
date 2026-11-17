# Recall eval

The owner's list of nights he knows are on, against what the site lists (SPEC section 8, PLAN 12, D-112).

```
cp evals/recall/template.csv evals/recall/nyc/2026-10-08.csv   # then fill it
pnpm eval:recall --metro nyc --date 2026-10-08                 # read-only
pnpm eval:recall --metro nyc --date 2026-10-08 --record        # also adds an eval_runs row
```

Needs `DATABASE_URL`. Columns: `title` (required), `venue`, `start_time`, `style`, `source_url`.

**Found** means a listing on that night that the dedupe scorer (D-006) would at least queue against the row (score 0.5 or more, starts within 90 minutes), or whose own event page or ticket link is the row's link, or whose organiser site and venue are the row's (the organizer link, D-090).

**Each miss** gets one class, first match wins:

| Class                  | Meaning                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deduped_away`         | a listing matching the row was merged into one that does not                                                                                                                                                     |
| `extracted_wrong`      | a listing of that title sits on the night before or after, or at another start; or a page we read names the title and no listing was written                                                                     |
| `no_source_known`      | no source shares a site with the row's link or its venue's website                                                                                                                                               |
| `source_not_harvested` | a source shares the site but was switched off, disallowed by robots.txt, failing, not fetched in the 14 days before the night, or fetched without naming the night (it is on a page of that site we do not read) |

The report also counts found and missed per style family, from the `style` column. A list drafted from what we already find will find it; only the owner's corrections measure what we miss (D-048, question 3).
