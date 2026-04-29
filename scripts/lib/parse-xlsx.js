import xlsx from 'xlsx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX = path.resolve(__dirname, '../../input/reyeslaw_image_audit.xlsx');

const FORMAT_MAP = {
  'image/avif': 'AVIF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
};

function normalizeUrl(url) {
  if (!url) return url;
  return url.replace('reyeslawdev.wpengine.com', 'www.reyeslaw.com');
}

function rowsFromSheet(wb, sheetName, mapper) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const json = xlsx.utils.sheet_to_json(ws, { defval: null });
  return json.map(mapper).filter(Boolean);
}

export function parseAudit(filePath = DEFAULT_XLSX) {
  const wb = xlsx.readFile(filePath);

  const inventory = rowsFromSheet(wb, 'Image Inventory', (r) => {
    if (!r['Attachment ID'] || !r['File URL']) return null;
    return {
      attachmentId: Number(r['Attachment ID']),
      fileType: FORMAT_MAP[r['File Type']] ?? null,
      originalUrl: normalizeUrl(r['File URL']),
      pageId: r['Page ID'] ? Number(r['Page ID']) : null,
      pageTitle: r['Page Title'] ?? '',
      pageUrl: r['Page URL'] ?? '',
      relationship: r['Relationship'] ?? '',
    };
  });

  const embedded = rowsFromSheet(wb, 'Embedded in Content', (r) => {
    if (!r['File URL']) return null;
    const attId = r['Attachment ID']
      ? Number(r['Attachment ID'])
      : Number.parseInt(`9${(r['Page ID'] ?? 0)}${(r['File URL']?.length ?? 0)}`, 10);
    return {
      attachmentId: attId,
      fileType: FORMAT_MAP[r['File Type']] ?? null,
      originalUrl: normalizeUrl(r['File URL']),
      pageId: r['Page ID'] ? Number(r['Page ID']) : null,
      pageTitle: r['Page Title'] ?? '',
      pageUrl: r['Page URL'] ?? '',
      relationship: r['Relationship'] ?? 'Embedded in Content',
    };
  });

  return { inventory, embedded, all: [...inventory, ...embedded] };
}

export function dedupeByAttachment(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.attachmentId || !row.originalUrl || !row.fileType) continue;
    const key = row.attachmentId;
    if (!map.has(key)) {
      map.set(key, {
        attachmentId: row.attachmentId,
        fileType: row.fileType,
        originalUrl: row.originalUrl,
        pages: [],
      });
    }
    const entry = map.get(key);
    if (row.pageId) {
      const pageKey = `${row.pageId}::${row.pageUrl}`;
      if (!entry.pages.some((p) => `${p.pageId}::${p.pageUrl}` === pageKey)) {
        entry.pages.push({
          pageId: row.pageId,
          pageTitle: row.pageTitle,
          pageUrl: row.pageUrl,
        });
      }
    }
  }
  return [...map.values()];
}

export function loadAndDedupe(filePath = DEFAULT_XLSX) {
  const { all } = parseAudit(filePath);
  return dedupeByAttachment(all);
}
