# ARA Web Image Library

Converts every non-WebP image on **reyeslaw.com** to optimized WebP and indexes the results in a Notion database (`ARA Web Image Library`).

- **Input:** `input/reyeslaw_image_audit.xlsx` (~2,094 image references → 1,490 unique files)
- **Output:** `webp-library/<attachment_id>-<slug>.webp` (committed, served via `raw.githubusercontent.com`)
- **Index:** Notion database with Original URL ↔ WebP URL ↔ pages-using mapping

See [`CLAUDE.md`](./CLAUDE.md) for full architecture, schema, and operating notes.

## Quick start

```bash
npm install
cp .env.example .env
# fill NOTION_TOKEN + NOTION_PARENT_PAGE_ID
npm run setup:notion          # creates the Notion DB, prints the database_id
# paste the database_id into .env as NOTION_DATABASE_ID
npm run smoke                 # convert 5 AVIF images as a smoke test
npm run convert               # full run
```

## Running in GitHub Actions

`Actions` → **Convert Images** → **Run workflow**. Optional inputs: `format_filter` (`avif`/`png`/`jpeg`) and `limit`. Required secrets: `NOTION_TOKEN`, `NOTION_DATABASE_ID`.
