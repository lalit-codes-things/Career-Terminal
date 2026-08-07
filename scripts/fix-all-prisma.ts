/**
 * Aggressively fix all remaining prisma references in production files
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC_DIR = join(process.cwd(), 'src');

function isTsFile(filePath: string): boolean {
  return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
}

function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(getAllTsFiles(fullPath));
      } else if (isTsFile(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip
  }
  return results;
}

const files = getAllTsFiles(SRC_DIR);
let totalChanges = 0;

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  // Only process files that have dbRouter import but still have prisma references
  const hasDbRouter = /import\s*\{?\s*dbRouter\s*\}?\s*from\s*['\"].*config\/database['\"]/.test(content);
  const hasPrisma = /(^|[^a-zA-Z])prisma\./.test(content);
  if (!hasDbRouter || !hasPrisma) continue;

  // Replace ALL prisma. patterns
  content = content.replace(/\bprisma\./g, 'dbRouter.write().');

  if (content !== original) {
    writeFileSync(filePath, content);
    totalChanges++;
  }
}

console.log(`Aggressively fixed ${totalChanges} files`);
