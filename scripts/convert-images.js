import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import slugify from 'slugify';
import pLimit from 'p-limit';

import { loadAndDedupe } from './lib/parse-xlsx.js';
import { downloadImage } from './lib/download.js';
import { toWebp } from './lib/convert.js';
import { makeClient, upsertImage, getStatus } from './lib/notion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'webp-library');
const LOG_DIR = path.join(ROOT, 'logs');

function parseArgs(argv) {
  const args = { limit: null, format: null, commit: true, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--format') args.format = argv[++i].toUpperCase();
    else if (a === '--no-commit') args.commit = false;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function fileNameFor(entry) {
  const urlPath = new URL(entry.originalUrl).pathname;
  const base = path.basename(urlPath, path.extname(urlPath));
  const slug = slugify(base, { lower: true, strict: true }) || 'image';
  return `${entry.attachmentId}-${slug}.webp`;
}

function gitCommitBatch(message) {
  try {
    execSync('git add webp-library/', { cwd: ROOT, stdio: 'pipe' });
    const status = execSync('git status --porcelain webp-library/', { cwd: ROOT }).toString();
    if (!status.trim()) return;
    execSync(`git commit -m "${message}"`, { cwd: ROOT, stdio: 'pipe' });
    if (process.env.CI) {
      execSync('git push', { cwd: ROOT, stdio: 'pipe' });
    }
  } catch (err) {
    console.warn('  git commit skipped:', err.message);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const databaseId = process.env.NOTION_DATABASE_ID;
  const rawBase = process.env.GITHUB_REPO_RAW_BASE;
  if (!databaseId) throw new Error('NOTION_DATABASE_ID is not set');
  if (!rawBase) throw new Error('GITHUB_REPO_RAW_BASE is not set');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  let entries = loadAndDedupe();
  if (args.format) entries = entries.filter((e) => e.fileType === args.format);
  if (args.limit) entries = entries.slice(0, args.limit);

  console.log(`Loaded ${entries.length} unique image(s) to process.`);
  if (args.dryRun) {
    console.log(JSON.stringify(entries.slice(0, 5), null, 2));
    return;
  }

  const client = makeClient();
  const limit = pLimit(Number(process.env.CONCURRENCY ?? 2));
  const log = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  const tasks = entries.map((entry, idx) => limit(async () => {
    const filename = fileNameFor(entry);
    const outPath = path.join(OUT_DIR, filename);
    const webpUrl = `${rawBase.replace(/\/$/, '')}/${filename}`;
    const baseName = path.basename(filename, '.webp');

    try {
      const existingStatus = await getStatus(client, databaseId, entry.attachmentId);
      if (existingStatus === 'Converted' && fs.existsSync(outPath)) {
        skipped++;
        log.push({ attachmentId: entry.attachmentId, status: 'Skipped', reason: 'already converted' });
        return;
      }

      const original = await downloadImage(entry.originalUrl);
      const originalSizeKb = Math.round(original.length / 1024);
      const webp = await toWebp(original);
      const webpSizeKb = Math.round(webp.length / 1024);
      fs.writeFileSync(outPath, webp);

      await upsertImage(client, databaseId, {
        filename: baseName,
        attachmentId: entry.attachmentId,
        originalUrl: entry.originalUrl,
        format: entry.fileType,
        webpUrl,
        originalSizeKb,
        webpSizeKb,
        pages: entry.pages,
        status: 'Converted',
      });

      succeeded++;
      log.push({ attachmentId: entry.attachmentId, status: 'Converted', originalSizeKb, webpSizeKb });
      console.log(`[${idx + 1}/${entries.length}] ✓ ${filename} (${originalSizeKb}→${webpSizeKb} KB)`);
    } catch (err) {
      failed++;
      const errorMsg = err.message ?? String(err);
      try {
        await upsertImage(client, databaseId, {
          filename: baseName,
          attachmentId: entry.attachmentId,
          originalUrl: entry.originalUrl,
          format: entry.fileType,
          pages: entry.pages,
          status: 'Failed',
          error: errorMsg,
        });
      } catch (notionErr) {
        console.error(`  notion update failed: ${notionErr.message}`);
      }
      log.push({ attachmentId: entry.attachmentId, status: 'Failed', error: errorMsg });
      console.error(`[${idx + 1}/${entries.length}] ✗ ${filename}: ${errorMsg}`);
    } finally {
      processed++;
      if (args.commit && processed % 50 === 0) {
        gitCommitBatch(`convert: batch through ${processed}`);
      }
    }
  }));

  await Promise.all(tasks);

  if (args.commit) gitCommitBatch(`convert: final batch (${succeeded} converted)`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `conversion-${stamp}.json`);
  fs.writeFileSync(logPath, JSON.stringify({
    summary: { total: entries.length, succeeded, failed, skipped },
    entries: log,
  }, null, 2));

  console.log(`\nDone. Converted: ${succeeded} · Failed: ${failed} · Skipped: ${skipped}`);
  console.log(`Log: ${logPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
