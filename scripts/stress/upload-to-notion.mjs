import { readFileSync } from 'node:fs';

const PAGE_ID_RAW = '3c9c0e8d81f080dfb5b1cf1e636ecb97';
const NOTION_API_VERSION = '2022-06-28';

function formatPageId(raw) {
  const cleaned = raw.replaceAll('-', '');
  if (cleaned.length === 32) {
    return `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`;
  }
  return raw;
}

function textChunk(content, annotations = {}) {
  return {
    type: 'text',
    text: { content: String(content).slice(0, 2000) },
    annotations,
  };
}

export function markdownToNotionBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Heading 1
    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [textChunk(trimmed.slice(2))] },
      });
      i++;
      continue;
    }

    // Heading 2
    if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [textChunk(trimmed.slice(3))] },
      });
      i++;
      continue;
    }

    // Heading 3
    if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [textChunk(trimmed.slice(4))] },
      });
      i++;
      continue;
    }

    // Markdown Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0].split('|').slice(1, -1).map((c) => c.trim());
        const dataRows = tableLines.slice(2); // skip separator line (|---|---|)
        const colWidth = headerCells.length;

        const tableChildren = [
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: headerCells.map((c) => [textChunk(c, { bold: true })]),
            },
          },
          ...dataRows.map((row) => {
            const cells = row.split('|').slice(1, -1).map((c) => c.trim());
            return {
              object: 'block',
              type: 'table_row',
              table_row: {
                cells: Array.from({ length: colWidth }, (_, idx) => [textChunk(cells[idx] || '')]),
              },
            };
          }),
        ];

        blocks.push({
          object: 'block',
          type: 'table',
          table: {
            table_width: colWidth,
            has_column_header: true,
            has_row_header: false,
            children: tableChildren,
          },
        });
      }
      continue;
    }

    // Bulleted list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [textChunk(trimmed.slice(2))] },
      });
      i++;
      continue;
    }

    // Numbered list item
    if (/^\d+\.\s/.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s/, '');
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [textChunk(content)] },
      });
      i++;
      continue;
    }

    // Standard paragraph
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [textChunk(trimmed)] },
    });
    i++;
  }

  return blocks;
}

export async function uploadReportToNotion({ token, parentPageId = PAGE_ID_RAW, reportPath = 'STRESS_TEST_REPORT.md' }) {
  if (!token) {
    throw new Error('Notion API Token is required. Pass via --token=secret_... or set NOTION_API_KEY environment variable.');
  }

  const formattedParentId = formatPageId(parentPageId);
  const markdown = readFileSync(reportPath, 'utf8');
  const allBlocks = markdownToNotionBlocks(markdown);

  console.log(`[Notion Upload] Parent Page ID: ${formattedParentId}`);
  console.log(`[Notion Upload] Parsed ${allBlocks.length} Notion blocks from ${reportPath}`);

  // Notion create page supports up to 100 initial child blocks
  const initialBatch = allBlocks.slice(0, 100);
  const remainingBlocks = allBlocks.slice(100);

  console.log(`[Notion Upload] Creating sub-page with title and initial ${initialBatch.length} blocks...`);
  const createRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { page_id: formattedParentId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: 'OnCue 桌面端与网关 API & WebSocket 压力测试报告' } }],
        },
      },
      children: initialBatch,
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Notion page (${createRes.status}): ${errorText}`);
  }

  const pageData = await createRes.json();
  const pageId = pageData.id;
  const pageUrl = pageData.url;
  console.log(`[Notion Upload] Page created successfully! ID: ${pageId}`);

  // Append any remaining blocks in chunks of 100
  let offset = 0;
  while (offset < remainingBlocks.length) {
    const chunk = remainingBlocks.slice(offset, offset + 100);
    console.log(`[Notion Upload] Appending blocks ${offset + 101} to ${offset + 100 + chunk.length}...`);
    const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ children: chunk }),
    });

    if (!appendRes.ok) {
      const appendErr = await appendRes.text();
      console.warn(`[Notion Upload] Warning: Failed to append block chunk: ${appendErr}`);
      break;
    }
    offset += 100;
  }

  console.log(`\n================================================================`);
  console.log(`✓ 压测报告已成功同步至 Notion:`);
  console.log(`  Page URL: ${pageUrl}`);
  console.log(`  Page ID:  ${pageId}`);
  console.log(`================================================================\n`);

  return { pageId, pageUrl };
}

if (process.argv[1] && process.argv[1].endsWith('upload-to-notion.mjs')) {
  const token = process.argv.find((a) => a.startsWith('--token='))?.split('=')[1] || process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  const pageArg = process.argv.find((a) => a.startsWith('--page='))?.split('=')[1] || PAGE_ID_RAW;

  uploadReportToNotion({ token, parentPageId: pageArg }).catch((err) => {
    console.error('Notion upload failed:', err.message);
    process.exit(1);
  });
}
