# CLAUDE.md — ARA Web Image Library

## About This Project

This repository converts every non-WebP image on **reyeslaw.com** (Angel Reyes & Associates) to optimized WebP and registers each one in a Notion database that acts as the **master index** linking original URL ↔ new WebP URL ↔ pages where the image is used.

**Scope:** Build the library only. This project does NOT modify reyeslaw.com or replace URLs in WordPress. That is a separate, future phase.

**Source of truth:** `input/reyeslaw_image_audit.xlsx` — exported from a WordPress media audit. Contains 2,094 image references across 751 pages (763 AVIF, 676 PNG, 655 JPEG; 1,490 unique files after dedupe).

---

## Stack

| Component | Choice |
|---|---|
| Runtime | Node.js 20 |
| Image conversion | `sharp` (libvips, supports AVIF/PNG/JPEG → WebP) |
| Spreadsheet parsing | `xlsx` |
| Notion API | `@notionhq/client` |
| Concurrency control | `p-limit` |
| Filename slugging | `slugify` |
| Env | `dotenv` |
| CI / orchestration | GitHub Actions (`workflow_dispatch`) |
| WebP hosting | This repo, public, served via `raw.githubusercontent.com` |
| Index / database | Notion DB **"ARA Web Image Library"** |

---

## Repository Layout

```
ara-web-image-library/
├── CLAUDE.md                          ← this file
├── README.md                          ← public-facing onboarding
├── package.json
├── .env.example                       ← copy to .env locally
├── .gitignore
├── progress.md                        ← Hub-format status tracker
├── input/
│   └── reyeslaw_image_audit.xlsx      ← input audit (source of truth)
├── scripts/
│   ├── convert-images.js              ← main pipeline
│   ├── setup-notion-db.js             ← one-time DB creator
│   └── lib/
│       ├── parse-xlsx.js              ← reads + dedupes the spreadsheet
│       ├── download.js                ← fetch with retry + timeout
│       ├── convert.js                 ← sharp wrapper (→ WebP)
│       └── notion.js                  ← Notion client + idempotent upsert
├── webp-library/                      ← OUTPUT (committed, public)
│   └── <attachment_id>-<slug>.webp
├── logs/
│   └── conversion-<timestamp>.json    ← per-run structured log
└── .github/
    └── workflows/
        └── convert-images.yml         ← GitHub Action
```

---

## How It Works (End-to-End)

```
input/reyeslaw_image_audit.xlsx
         │
         ▼  parse-xlsx.js
[merge Image Inventory + Embedded in Content sheets, dedupe by Attachment ID]
         │
         ▼  for each unique file:
download.js  →  download original (timeout 30s, 3 retries)
         │
         ▼
convert.js   →  sharp({ quality: 82, effort: 4 }).webp()
         │
         ▼
write to /webp-library/<attachment_id>-<slug>.webp
         │
         ▼  notion.js
upsert Notion row (search by Attachment ID; create or update)
         │
         ▼  every 50 files
git add webp-library/ && git commit && git push
```

Each row in Notion gets a `WebP URL` of the form:
```
https://raw.githubusercontent.com/<github-user>/ara-web-image-library/main/webp-library/<attachment_id>-<slug>.webp
```

---

## Notion Database Schema — "ARA Web Image Library"

Created programmatically by `scripts/setup-notion-db.js`.

| Property | Type | Notes |
|---|---|---|
| Filename | Title | Original filename without extension |
| Attachment ID | Number | From audit spreadsheet — used as primary dedupe key |
| Original URL | URL | Source URL on reyeslaw.com |
| Original Format | Select | `AVIF` · `PNG` · `JPEG` |
| WebP URL | URL | `raw.githubusercontent.com/.../webp-library/...webp` |
| Original Size (KB) | Number | |
| WebP Size (KB) | Number | |
| Reduction % | Number | `(1 − webp/original) × 100` |
| Pages Using | Rich Text | One line per page: `Page Title — Page URL` |
| Page Count | Number | Number of pages referencing this file |
| Status | Select | `Pending` · `Converted` · `Failed` · `Skipped` |
| Converted At | Date | |
| Error | Rich Text | Populated only when `Status = Failed` |

---

## Naming Convention

WebP files in `/webp-library/` use:

```
<attachment_id>-<slug>.webp
```

- `attachment_id` is the WordPress attachment ID from the audit (stable, unique).
- `slug` is `slugify(original_filename_without_extension, { lower: true, strict: true })`.

Example: original `https://www.reyeslaw.com/wp-content/uploads/2025/02/bbvhjgfjuydwba2jzxwu.avif` (Attachment ID 48873) → `48873-bbvhjgfjuydwba2jzxwu.webp`.

The `attachment_id` prefix guarantees no filename collisions between different uploads that happen to share the same slug.

---

## Environment Variables

Copy `.env.example` to `.env` for local runs. In GitHub Actions these are set as repository secrets.

| Variable | Required | Description |
|---|---|---|
| `NOTION_TOKEN` | yes | Internal Integration Secret. Use the global `NOTION_INTEGRATION_TOKEN` from your Windows env. The integration must be **connected** (via "Add connections") to the parent Notion page where the DB lives. |
| `NOTION_DATABASE_ID` | yes | Output of `scripts/setup-notion-db.js`. Save it after the first run. |
| `NOTION_PARENT_PAGE_ID` | only for setup | The page where the DB will be created. Used only by `setup-notion-db.js`. |
| `GITHUB_REPO_RAW_BASE` | yes | Base URL for WebP. Default: `https://raw.githubusercontent.com/<user>/ara-web-image-library/main/webp-library`. Used to build `WebP URL` values. |

---

## Running

### One-time setup

```bash
npm install
cp .env.example .env
# fill in NOTION_TOKEN, NOTION_PARENT_PAGE_ID
node scripts/setup-notion-db.js
# copy the printed database_id into NOTION_DATABASE_ID in .env
```

### Local conversion (smoke test)

```bash
# convert 5 AVIF images only
node scripts/convert-images.js --limit 5 --format avif

# convert all PNGs
node scripts/convert-images.js --format png

# full run
node scripts/convert-images.js
```

CLI flags:

| Flag | Default | Description |
|---|---|---|
| `--limit <n>` | none | Process only the first `n` unique files |
| `--format <avif\|png\|jpeg>` | none | Filter by source format |
| `--no-commit` | false | Skip incremental git commits (useful when running locally) |
| `--dry-run` | false | Parse and dedupe only, skip download/convert/upsert |

### Via GitHub Action

`Actions` tab → **Convert Images** → **Run workflow** → optional `format_filter` and `batch_size` inputs.

The Action checks out the repo, runs the script, and pushes the new `.webp` files back to `main`.

---

## Idempotency & Resume

The script is fully idempotent:

1. Before processing each file, it checks Notion for an existing row with the same `Attachment ID`.
2. If found and `Status = Converted`, it skips.
3. If found and `Status = Failed` or `Pending`, it retries.
4. If not found, it creates a new row.

This means you can safely:
- Re-run the script as many times as you want.
- Kill it mid-run and restart — it picks up where it left off.
- Add new rows to the spreadsheet and re-run — only new files will be processed.

---

## Adding New Images Later

1. Update `input/reyeslaw_image_audit.xlsx` with the new audit export.
2. Commit it.
3. Trigger the GitHub Action (or run locally).
4. Only newly-listed files will be converted; existing entries are skipped.

---

## Compliance Note (Texas State Bar)

The images converted here are existing assets already published on reyeslaw.com — this project does not generate new advertising material, so the Texas Disciplinary Rules of Professional Conduct (Rules 7.01–7.07) do not apply to the conversion itself.

However, if any image **contains case results, monetary recoveries, or attorney photos used in advertising context**, the disclaimers and identification requirements continue to apply wherever the image is displayed. See `../Claude Code Hub/Angel Reyes & Associates/guidelines/texas-bar-compliance.md` for the full rules. Conversion preserves the image as-is; it does not alter compliance status.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `429 Too Many Requests` from Notion | Rate limit (3 req/s) | `p-limit(3)` is already enforced; if it persists, drop concurrency to 2 in `scripts/lib/notion.js`. |
| `ETIMEDOUT` downloading | Slow or 404 on reyeslaw.com | Auto-retried 3× with backoff. After 3 failures, row is marked `Status = Failed` with the error in `Error` field. |
| Image is `wpengine.com` not `reyeslaw.com` | Embedded content sheet has dev URLs | `parse-xlsx.js` normalizes `reyeslawdev.wpengine.com` → `www.reyeslaw.com` before download. |
| GitHub Action exceeds 6h | Too many files in one run | Use `format_filter` input to split into AVIF / PNG / JPEG runs. |
| `.webp` 404 from `raw.githubusercontent.com` | Push hasn't completed yet | The Action commits in batches of 50. Wait for the Action to finish and refresh. |
| Notion: "Could not find database" | Integration not connected to parent page | In Notion, open the parent page → `...` → **Connections** → add the integration. |

---

## Estimated Runtime & Storage

- **Files:** ~1,490 unique
- **Per file:** ~2s (download + convert + upsert)
- **Total runtime:** ~50 minutes for a clean run
- **Disk:** ~220 MB total (avg 150 KB/file). Well under Git limits — no LFS needed.
- **Notion API calls:** ~3,000 (search + create/update). Fits comfortably in rate limits at 3 req/s.

---

## What's NOT in This Repo

- WordPress credentials or the WP REST client.
- Any code that modifies `reyeslaw.com`.
- The original (non-WebP) images. We download them on-demand from reyeslaw.com during conversion.

---

## Related

- Parent workspace: `Claude Code Hub/Angel Reyes & Associates/` — brand voice, compliance, and other ARA marketing projects.
- Audit source: WordPress queries against `wp_posts` and `wp_postmeta` (see Summary sheet in the xlsx for query notes).
