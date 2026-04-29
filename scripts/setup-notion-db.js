import 'dotenv/config';
import { makeClient, DB_PROPS } from './lib/notion.js';

function extractPageId(input) {
  if (!input) return null;
  const compact = input.replace(/-/g, '');
  const match = compact.match(/[a-f0-9]{32}/i);
  if (!match) return null;
  const id = match[0];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function main() {
  const parentRaw = process.env.NOTION_PARENT_PAGE_ID;
  const parentId = extractPageId(parentRaw);
  if (!parentId) {
    console.error('NOTION_PARENT_PAGE_ID is missing or invalid. Paste a Notion page ID or full URL into .env.');
    process.exit(1);
  }

  const client = makeClient();
  const db = await client.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    title: [{ type: 'text', text: { content: 'ARA Web Image Library' } }],
    properties: DB_PROPS,
  });

  console.log('\nDatabase created.');
  console.log('Add this to your .env:\n');
  console.log(`NOTION_DATABASE_ID=${db.id}\n`);
  console.log(`URL: ${db.url}`);
}

main().catch((err) => {
  console.error('Setup failed:', err.body ?? err.message ?? err);
  process.exit(1);
});
