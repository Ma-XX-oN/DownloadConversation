import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PART_BYTES = 24 * 1024;
export const USERSCRIPT_HEADER_END_RE = /^\/\/ ==\/UserScript==\r?\n/m;

export function splitUserscript(source) {
  const match = USERSCRIPT_HEADER_END_RE.exec(source);
  if (!match) {
    throw new Error('Userscript metadata terminator was not found.');
  }
  const bodyStart = match.index + match[0].length;
  return {
    header: source.slice(0, bodyStart),
    body: source.slice(bodyStart)
  };
}

export function replaceUserscriptHeader(userscript, header) {
  const original = splitUserscript(userscript);
  const replacement = splitUserscript(header);
  if (replacement.body.length !== 0) {
    throw new Error('Authoritative userscript header must contain metadata only.');
  }
  return `${replacement.header}${original.body}`;
}

export function splitTextAtNewlines(text, maxBytes = DEFAULT_PART_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Fragment byte limit must be a positive integer.');
  }
  if (text.length === 0) return [];

  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const parts = [];
  let current = '';
  let currentBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > maxBytes) {
      throw new Error(`One source line is ${lineBytes} bytes, above the ${maxBytes}-byte fragment limit.`);
    }
    if (current && currentBytes + lineBytes > maxBytes) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += line;
    currentBytes += lineBytes;
  }

  if (current) parts.push(current);
  return parts;
}

export function gitBlobSha1(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const prefix = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}

export async function readUserscriptManifest(rootDir, manifestPath = 'src/userscript-manifest.json') {
  const fullPath = path.resolve(rootDir, manifestPath);
  const manifest = JSON.parse(await readFile(fullPath, 'utf8'));
  if (manifest?.format_version !== 1) {
    throw new Error(`Unsupported userscript manifest format: ${manifest?.format_version ?? 'missing'}.`);
  }
  if (typeof manifest.header !== 'string' || !Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error('Userscript manifest must define one header and at least one ordered source part.');
  }
  return manifest;
}

export async function assembleUserscript(rootDir, manifest) {
  const files = [manifest.header, ...manifest.parts];
  const chunks = [];
  for (const relativePath of files) {
    chunks.push(await readFile(path.resolve(rootDir, relativePath), 'utf8'));
  }
  return chunks.join('');
}
