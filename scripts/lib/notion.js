import { Client } from '@notionhq/client';

export const DB_PROPS = {
  Filename: { title: {} },
  'Attachment ID': { number: {} },
  'Original URL': { url: {} },
  'Original Format': {
    select: { options: [
      { name: 'AVIF', color: 'red' },
      { name: 'PNG', color: 'blue' },
      { name: 'JPEG', color: 'yellow' },
    ] },
  },
  'WebP URL': { url: {} },
  'Original Size (KB)': { number: { format: 'number' } },
  'WebP Size (KB)': { number: { format: 'number' } },
  'Reduction %': { number: { format: 'number' } },
  'Pages Using': { rich_text: {} },
  'Page Count': { number: { format: 'number' } },
  Status: {
    select: { options: [
      { name: 'Pending', color: 'gray' },
      { name: 'Converted', color: 'green' },
      { name: 'Failed', color: 'red' },
      { name: 'Skipped', color: 'yellow' },
    ] },
  },
  'Converted At': { date: {} },
  Error: { rich_text: {} },
};

export function makeClient(token = process.env.NOTION_TOKEN) {
  if (!token) throw new Error('NOTION_TOKEN is not set');
  return new Client({ auth: token });
}

export function rowToProperties({ filename, attachmentId, originalUrl, format, webpUrl, originalSizeKb, webpSizeKb, pages, status, error }) {
  const reduction = originalSizeKb && webpSizeKb
    ? Math.round((1 - webpSizeKb / originalSizeKb) * 1000) / 10
    : null;
  const pagesText = (pages ?? [])
    .map((p) => `${p.pageTitle} — ${p.pageUrl}`)
    .join('\n')
    .slice(0, 1900);

  const props = {
    Filename: { title: [{ text: { content: String(filename ?? '').slice(0, 200) } }] },
    'Attachment ID': { number: attachmentId ?? null },
    'Original URL': { url: originalUrl ?? null },
    'Original Format': format ? { select: { name: format } } : { select: null },
    'WebP URL': { url: webpUrl ?? null },
    'Original Size (KB)': { number: originalSizeKb ?? null },
    'WebP Size (KB)': { number: webpSizeKb ?? null },
    'Reduction %': { number: reduction },
    'Pages Using': { rich_text: pagesText ? [{ text: { content: pagesText } }] : [] },
    'Page Count': { number: pages?.length ?? 0 },
    Status: status ? { select: { name: status } } : { select: { name: 'Pending' } },
    'Converted At': status === 'Converted' ? { date: { start: new Date().toISOString() } } : { date: null },
    Error: { rich_text: error ? [{ text: { content: String(error).slice(0, 1900) } }] : [] },
  };
  return props;
}

export async function findByAttachmentId(client, databaseId, attachmentId) {
  const res = await client.databases.query({
    database_id: databaseId,
    filter: { property: 'Attachment ID', number: { equals: attachmentId } },
    page_size: 1,
  });
  return res.results[0] ?? null;
}

export async function upsertImage(client, databaseId, payload) {
  const existing = await findByAttachmentId(client, databaseId, payload.attachmentId);
  const properties = rowToProperties(payload);
  if (existing) {
    await client.pages.update({ page_id: existing.id, properties });
    return { id: existing.id, created: false, status: payload.status };
  }
  const created = await client.pages.create({
    parent: { database_id: databaseId },
    properties,
  });
  return { id: created.id, created: true, status: payload.status };
}

export async function getStatus(client, databaseId, attachmentId) {
  const existing = await findByAttachmentId(client, databaseId, attachmentId);
  if (!existing) return null;
  return existing.properties?.Status?.select?.name ?? null;
}
