# Seed data and fixtures

| File | What it is |
|---|---|
| `PS-04.db` | The organisers' PS-04 dataset (SQLite, 28,103 rows, fully synthetic). Opened read-only; this is the seed the demo runs on. |
| `schema.sqlite.sql` | The dataset's canonical DDL. The app database creates its canonical tables by copying these statements verbatim. |
| `enums.json` | Legal values for every enum column (rule R5). |
| `queries/starter_queries.sql` | The organisers' starter queries: `sqlite3 data-model/seed/PS-04.db < data-model/seed/queries/starter_queries.sql` |
| `WORKING_WITH_THE_DATA.md` | The organisers' conventions (R1–R8). |
| `translation-cache.json` | Demo fixture: cached Sarvam translations of dataset strings (हिन्दी, தமிழ், తెలుగు), so the demo is multilingual offline. |
| `city-images.json` | Demo fixture: resolved Wikipedia photo URLs per destination. |

The demo scenario uses dataset rows only; see `../DATA_MODEL.md` → "Seed / fixtures for the demo". Reset the app database before a demo with `pnpm db:reset`.
