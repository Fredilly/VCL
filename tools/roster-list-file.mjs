import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * Read a partner's product list from disk as plain text.
 *
 * Partners keep these lists in Google Docs / Word as often as in a text file,
 * so a .docx is read directly (no export step, no extra dependency): paragraph
 * and line breaks become lines, and a hyperlink contributes the address it
 * actually points to, not just its visible text.
 */

function zipEntries(buffer) {
  // End-of-central-directory record: last 22+ bytes, signature PK\x05\x06.
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a readable .docx (zip directory missing)');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Not a readable .docx (bad zip entry)');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return name => {
    const entry = entries.get(name);
    if (!entry) return null;
    const start = entry.localOffset + 30 + buffer.readUInt16LE(entry.localOffset + 26) + buffer.readUInt16LE(entry.localOffset + 28);
    const data = buffer.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data.toString('utf8');
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: 50_000_000 }).toString('utf8');
    throw new Error(`Unsupported .docx compression (${entry.method})`);
  };
}

const xmlText = value => value
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_all, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&amp;/g, '&');

function runsText(xml) {
  let out = '';
  for (const token of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(br|cr|tab)\b[^>]*\/>/g)) {
    out += token[1] !== undefined ? xmlText(token[1]) : token[2] === 'tab' ? '\t' : '\n';
  }
  return out;
}

/** Word's automatic "1. 2. 3." numbering is not text in the file; rebuild it. */
function numberFormats(numberingXml) {
  const formats = new Map();
  if (!numberingXml) return formats;
  const abstract = new Map();
  for (const match of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const level0 = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/.exec(match[2]);
    abstract.set(match[1], /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(level0?.[1] ?? '')?.[1] ?? 'bullet');
  }
  for (const match of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const id = /<w:abstractNumId\b[^>]*w:val="(\d+)"/.exec(match[2])?.[1];
    if (id) formats.set(match[1], abstract.get(id) ?? 'bullet');
  }
  return formats;
}

export function docxToText(buffer) {
  const read = zipEntries(buffer);
  const documentXml = read('word/document.xml');
  if (!documentXml) throw new Error('Not a readable .docx (word/document.xml missing)');
  const targets = new Map();
  for (const rel of (read('word/_rels/document.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
    if (id && target && /TargetMode="External"/.test(rel[0])) targets.set(id, xmlText(target));
  }
  const formats = numberFormats(read('word/numbering.xml'));
  const counters = new Map();
  const lines = [];
  for (const paragraph of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const body = paragraph[1] ?? '';
    let text = '';
    let cursor = 0;
    for (const link of body.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)) {
      text += runsText(body.slice(cursor, link.index));
      const shown = runsText(link[2]);
      const target = targets.get(/r:id="([^"]+)"/.exec(link[1])?.[1] ?? '');
      // The address the link opens is the truth; visible text can be truncated or a label.
      text += !target ? shown : /^\s*https?:\/\//i.test(shown) ? target : `${shown} ${target}`;
      cursor = link.index + link[0].length;
    }
    text += runsText(body.slice(cursor));
    const numbering = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(body)?.[1];
    if (numbering && text.trim()) {
      const numId = /<w:numId\b[^>]*w:val="(\d+)"/.exec(numbering)?.[1] ?? '';
      const level = Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(numbering)?.[1] ?? 0);
      if (level === 0 && formats.get(numId) === 'decimal') {
        counters.set(numId, (counters.get(numId) ?? 0) + 1);
        text = `${counters.get(numId)}. ${text}`;
      } else text = `- ${text}`;
    }
    lines.push(text);
  }
  return lines.join('\n');
}

/** Any list file -> text. `-` reads stdin. */
export function readListFile(path) {
  const buffer = readFileSync(path === '-' ? 0 : path);
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip) return docxToText(buffer);
  if (/\.(docx?|pdf|pages|xlsx?|numbers)$/i.test(path)) throw new Error(`Cannot read ${path.split('.').pop()} files directly. Export the list as .docx, .txt, .md or .csv.`);
  return buffer.toString('utf8');
}
