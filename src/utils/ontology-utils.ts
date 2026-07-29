import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Robust CSV Parser for production-grade data ingestion
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(cell);
      cell = '';
      if (ch === '\n') {
        if (row.some((v) => v.length > 0)) rows.push(row);
        row = [];
      }
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }

  return rows;
}

/**
 * Normalizes strings for consistent matching and storage
 */
export function normalise(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Splits ESCO altLabels or similar pipe/newline separated strings
 */
export function splitAltLabels(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Calculates SHA-256 checksum for data provenance
 */
export async function getFileChecksum(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}
