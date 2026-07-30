import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseCsv, normalise, splitAltLabels, getFileChecksum } from '../src/utils/ontology-utils';

const prisma = new PrismaClient();

// Configuration
const REPO_ROOT = process.env.REPO_ROOT || path.resolve(process.cwd());
const DATA_DIR = path.join(REPO_ROOT, 'data');
const REPORT_PATH = path.join(REPO_ROOT, 'ontology-import-report.json');

interface ImportStats {
  source: string;
  version: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  errors: string[];
  durationMs: number;
}

const globalStats: ImportStats[] = [];

/**
 * Register or update an ontology source for provenance tracking
 */
async function registerSource(name: string, version: string, provider: string, license: string, url: string, filePath?: string) {
  const checksum = filePath ? await getFileChecksum(filePath) : null;
  return await prisma.ontologySource.upsert({
    where: { name_version: { name, version } },
    create: { name, version, provider, license, sourceUrl: url, checksum },
    update: { provider, license, sourceUrl: url, checksum },
  });
}

/**
 * ISCO Backbone Importer
 */
async function loadIsco(version: string = '08') {
  const start = Date.now();
  const stats: ImportStats = { source: 'ISCO', version, recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log(`[ISCO] Starting import version ${version}...`);

  const iscoFile = path.join(DATA_DIR, 'raw', 'isco', 'latest', 'isco.csv');
  try {
    await registerSource('ISCO', version, 'International Labour Organization', 'Public Domain', 'https://www.ilo.org/', iscoFile);
    const content = await fs.readFile(iscoFile, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) throw new Error('Missing header in isco.csv');

    const idx = {
      code: header.indexOf('unit'),
      title: header.indexOf('description'),
    };

    if (idx.code === -1 || idx.title === -1) {
      throw new Error(`ISCO CSV headers not found. Found: ${header.join(', ')}`);
    }

    for (const row of rows) {
      stats.recordsProcessed++;
      const code = row[idx.code]?.trim();
      const title = row[idx.title]?.trim();
      if (!code || !title) continue;

      await prisma.canonicalOccupation.upsert({
        where: { source_sourceId: { source: 'ISCO', sourceId: code } },
        create: {
          canonicalName: title,
          source: 'ISCO',
          sourceId: code,
          sourceVersion: version,
        },
        update: { canonicalName: title }
      });
      stats.recordsCreated++;
    }
  } catch (err: any) {
    stats.errors.push(err.message);
  }
  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
}

/**
 * ESCO Importer (Expanded)
 */
async function loadEsco(version: string = '1.2.1') {
  const start = Date.now();
  const stats: ImportStats = { source: 'ESCO', version, recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log(`[ESCO] Starting import version ${version}...`);

  const escoDir = path.join(DATA_DIR, 'raw', 'esco', `v${version}`);
  const occFile = path.join(escoDir, 'occupations_en.csv');
  const skillFile = path.join(escoDir, 'skills_en.csv');

  try {
    await registerSource('ESCO', version, 'European Commission', 'CC BY 4.0', 'https://esco.ec.europa.eu/', occFile);

    // 1. Occupations
    const occContent = await fs.readFile(occFile, 'utf8');
    const occRows = parseCsv(occContent);
    const occHeader = occRows.shift();
    if (occHeader) {
      const idx = {
        uri: occHeader.indexOf('conceptUri'),
        label: occHeader.indexOf('preferredLabel'),
        altLabels: occHeader.indexOf('altLabels'),
        type: occHeader.indexOf('conceptType'),
        iscoGroup: occHeader.indexOf('iscoGroup'),
      };

      for (const row of occRows) {
        stats.recordsProcessed++;
        if (row[idx.type] !== 'Occupation') continue;
        const id = row[idx.uri];
        const label = normalise(row[idx.label] ?? '');
        const iscoCode = row[idx.iscoGroup];
        if (!id || !label) continue;

        try {
          const alts = splitAltLabels(row[idx.altLabels] ?? '').map(normalise);
          const occ = await prisma.canonicalOccupation.upsert({
            where: { source_sourceId: { source: 'ESCO', sourceId: id } },
            create: {
              canonicalName: label,
              source: 'ESCO',
              sourceId: id,
              sourceVersion: version,
              aliases: { create: alts.map(alias => ({ alias })) }
            },
            update: { canonicalName: label }
          });
          stats.recordsCreated++;

          if (iscoCode) {
            await prisma.occupationClassificationMapping.upsert({
              where: { occupationId_classificationSystem_externalCode: { occupationId: occ.id, classificationSystem: 'ISCO', externalCode: iscoCode } },
              create: { occupationId: occ.id, classificationSystem: 'ISCO', externalCode: iscoCode },
              update: {}
            });
          }
        } catch (e: any) {
          stats.errors.push(`Occupation ${id}: ${e.message}`);
        }
      }
    }

    // 2. Skills
    const skillContent = await fs.readFile(skillFile, 'utf8');
    const skillRows = parseCsv(skillContent);
    const skillHeader = skillRows.shift();
    if (skillHeader) {
      const idx = {
        uri: skillHeader.indexOf('conceptUri'),
        label: skillHeader.indexOf('preferredLabel'),
        altLabels: skillHeader.indexOf('altLabels'),
        type: skillHeader.indexOf('conceptType'),
        skillType: skillHeader.indexOf('skillType'),
      };

      for (const row of skillRows) {
        stats.recordsProcessed++;
        if (row[idx.type] !== 'KnowledgeSkillCompetence') continue;
        const id = row[idx.uri];
        const label = normalise(row[idx.label] ?? '');
        if (!id || !label) continue;

        const rawType = (row[idx.skillType] ?? '').toLowerCase();
        let type = 'SKILL';
        if (rawType.includes('knowledge')) type = 'KNOWLEDGE';
        else if (rawType.includes('language')) type = 'LANGUAGE';
        else if (rawType.includes('attitude') || rawType.includes('value')) type = 'TRANSVERSAL';

        try {
          const alts = splitAltLabels(row[idx.altLabels] ?? '').map(normalise);
          await prisma.canonicalSkill.upsert({
            where: { source_sourceId: { source: 'ESCO', sourceId: id } },
            create: {
              canonicalName: label,
              source: 'ESCO',
              sourceId: id,
              sourceVersion: version,
              skillType: type,
              aliases: { create: alts.map(alias => ({ alias })) }
            },
            update: { canonicalName: label, skillType: type }
          });
          stats.recordsCreated++;
        } catch (e: any) {
          stats.errors.push(`Skill ${id}: ${e.message}`);
        }
      }
    }
  } catch (err: any) {
    stats.errors.push(`Global: ${err.message}`);
    console.error(`[ESCO] Failed: ${err.message}`);
  }

  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
  console.log(`[ESCO] Finished. Processed: ${stats.recordsProcessed}, Errors: ${stats.errors.length}`);
}

/**
 * ONET Importer (Expanded)
 */
async function loadOnet(version: string = '30.3') {
  const start = Date.now();
  const stats: ImportStats = { source: 'ONET', version, recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log(`[ONET] Starting import version ${version}...`);

  const onetDir = path.join(DATA_DIR, 'raw', 'onet', `v${version}`);
  const titleFile = path.join(onetDir, 'job_titles.csv');

  try {
    await registerSource('ONET', version, 'U.S. Department of Labor', 'CC BY 4.0', 'https://www.onetcenter.org/', titleFile);

    const content = await fs.readFile(titleFile, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) throw new Error('Missing header in job_titles.csv');

    const idx = {
      code: header.indexOf('O*NET-SOC Code'),
      title: header.indexOf('Title'),
      jobTitle: header.indexOf('Job Title'),
      shortTitle: header.indexOf('Short Title'),
    };

    for (const row of rows) {
      stats.recordsProcessed++;
      const socCode = row[idx.code];
      const title = normalise(row[idx.title] ?? '');
      const jobTitle = normalise(row[idx.jobTitle] ?? '');
      const shortTitle = normalise(row[idx.shortTitle] ?? '');
      if (!socCode) continue;

      const mainLabel = title || jobTitle || shortTitle;
      if (!mainLabel) continue;

      try {
        const sourceId = `${socCode}-${jobTitle}`;
        const alts = Array.from(new Set([jobTitle, shortTitle].filter(Boolean)));
        
        const occ = await prisma.canonicalOccupation.upsert({
          where: { source_sourceId: { source: 'ONET', sourceId } },
          create: {
            canonicalName: mainLabel,
            source: 'ONET',
            sourceId,
            sourceVersion: version,
            aliases: { create: alts.map(alias => ({ alias })) }
          },
          update: {}
        });
        stats.recordsCreated++;

        await prisma.occupationClassificationMapping.upsert({
          where: { occupationId_classificationSystem_externalCode: { occupationId: occ.id, classificationSystem: 'ONET-SOC', externalCode: socCode } },
          create: { occupationId: occ.id, classificationSystem: 'ONET-SOC', externalCode: socCode },
          update: {}
        });
      } catch (e: any) {
        stats.errors.push(`Occupation ${socCode}: ${e.message}`);
      }
    }
  } catch (err: any) {
    stats.errors.push(`Global: ${err.message}`);
    console.error(`[ONET] Failed: ${err.message}`);
  }

  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
  console.log(`[ONET] Finished. Processed: ${stats.recordsProcessed}, Errors: ${stats.errors.length}`);
}

/**
 * ISO 3166 (Countries) & Timezone Importer
 */
async function loadCountriesAndZones() {
  const start = Date.now();
  const stats: ImportStats = { source: 'ISO-3166-Timezone', version: 'latest', recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log('[ISO] Loading Countries and Timezones...');

  try {
    const isoPath = path.join(DATA_DIR, 'raw', 'iso', '3166', 'isco3166.csv');
    const isoContent = await fs.readFile(isoPath, 'utf8');
    const isoRows = parseCsv(isoContent);
    const isoHeader = isoRows.shift();
    
    if (isoHeader) {
      const nameIdx = isoHeader.indexOf('name');
      const a2Idx   = isoHeader.indexOf('alpha-2');
      const a3Idx   = isoHeader.indexOf('alpha-3');

      for (const row of isoRows) {
        stats.recordsProcessed++;
        const name = row[nameIdx]?.trim();
        const a2   = row[a2Idx]?.trim();
        const a3   = row[a3Idx]?.trim();
        if (!name || !a2 || !a3) continue;

        await prisma.canonicalCountry.upsert({
          where:  { isoAlpha2: a2 },
          create: { name, isoAlpha2: a2, isoAlpha3: a3 },
          update: { name, isoAlpha3: a3 },
        });
        stats.recordsCreated++;
      }
    }

    const tzPath = path.join(DATA_DIR, 'raw', 'timezone', 'latest', 'time_zone.csv');
    try {
      const tzContent = await fs.readFile(tzPath, 'utf8');
      const tzRows = parseCsv(tzContent);
      const tzHeader = tzRows.shift();
      if (tzHeader) {
        const codeIdx = tzHeader.indexOf('country_code');
        const zoneIdx = tzHeader.indexOf('zone_name');
        
        for (const row of tzRows) {
          stats.recordsProcessed++;
          const code     = row[codeIdx]?.trim();
          const zoneName = row[zoneIdx]?.trim();
          if (!code || !zoneName) continue;

          const country = await prisma.canonicalCountry.findUnique({ where: { isoAlpha2: code } });
          if (!country) continue;

          await prisma.canonicalTimeZone.upsert({
            where:  { zoneName },
            create: { zoneName, countryCode: code },
            update: { countryCode: code },
          });
          stats.recordsCreated++;
        }
      }
    } catch {
      console.warn('[ISO] TimeZoneDB not found — skipping timezone import.');
    }
  } catch (err: any) {
    stats.errors.push(err.message);
  }

  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
}

/**
 * ISO 4217 (Currencies) Importer
 */
async function loadCurrencies() {
  const start = Date.now();
  const stats: ImportStats = { source: 'ISO-4217', version: 'latest', recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log('[ISO] Loading Currencies...');

  try {
    const filePath = path.join(DATA_DIR, 'raw', 'iso', '4217', 'iso4217.csv');
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();

    if (header) {
      const codeIdx = header.indexOf('code');
      const nameIdx = header.indexOf('name');
      const symIdx  = header.indexOf('symbol');
      const unitIdx = header.indexOf('minor_units');

      for (const row of rows) {
        stats.recordsProcessed++;
        const code = row[codeIdx]?.trim();
        const name = row[nameIdx]?.trim();
        if (!code || !name) continue;

        await prisma.canonicalCurrency.upsert({
          where: { code },
          create: { 
            code, 
            name, 
            symbol: row[symIdx]?.trim(), 
            minorUnits: parseInt(row[unitIdx] || '0'),
            source: 'ISO',
            sourceId: code
          },
          update: { name, symbol: row[symIdx]?.trim() }
        });
  stats.recordsCreated++;
      }
    }
  } catch (err: any) {
    stats.errors.push(err.message);
  }

  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
}

/**
 * O*NET Skills, Abilities, and Knowledge Importer
 * Imports unique skill/ability/knowledge names from O*NET CSVs into canonical_skills
 */
async function loadOnetContentSkills(version: string = '30.3') {
  const start = Date.now();
  const stats: ImportStats = { source: 'ONET-Skills', version, recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, errors: [], durationMs: 0 };
  console.log('[ONET-Skills] Importing essential skills...');

  const onetDir = path.join(DATA_DIR, 'raw', 'onet', `v${version}`);

  const contentFiles = [
    { file: 'essential_skills.csv', type: 'SKILL', prefix: 'ONET-SKILL-' },
    { file: 'abilities.csv', type: 'ABILITY', prefix: 'ONET-ABILITY-' },
    { file: 'knowledge.csv', type: 'KNOWLEDGE', prefix: 'ONET-KNOWLEDGE-' },
  ];

  const uniqueElements = new Map<string, { name: string; type: string }>();

  for (const { file, type } of contentFiles) {
    try {
      const filePath = path.join(onetDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const rows = parseCsv(content);
      const header = rows.shift();
      if (!header) continue;

      const nameIdx = header.indexOf('Element Name');
      if (nameIdx === -1) continue;

      for (const row of rows) {
        const name = row[nameIdx]?.trim();
        if (!name) continue;
        const key = name.toLowerCase().trim();
        if (!uniqueElements.has(key)) {
          uniqueElements.set(key, { name, type });
        }
      }
    } catch (err: any) {
      stats.errors.push(`Failed to read ${file}: ${err.message}`);
    }
  }

  let created = 0;
  for (const [, { name, type }] of uniqueElements) {
    stats.recordsProcessed++;
    const sourceId = `ONET-${name.replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').toLowerCase()}`;
    try {
      await prisma.canonicalSkill.upsert({
        where: { source_sourceId: { source: 'ONET', sourceId } },
        create: {
          canonicalName: name.toLowerCase(),
          source: 'ONET',
          sourceId,
          sourceVersion: version,
          skillType: type,
        },
        update: {},
      });
      created++;
    } catch (e: any) {
      stats.errors.push(`Skill ${name}: ${e.message}`);
    }
  }

  stats.recordsCreated = created;
  stats.durationMs = Date.now() - start;
  globalStats.push(stats);
  console.log(`[ONET-Skills] Finished. Imported ${created} unique skills from ${contentFiles.length} files.`);
}

/**
 * Main Execution
 */
async function main() {
  console.log('Starting production-grade ontology import...');
  
  try {
    await loadIsco();
    await loadCountriesAndZones();
    await loadLanguages();
    await loadCurrencies();
    await loadEsco('1.2.1');
    await loadOnet('30.3');
    await loadOnetContentSkills('30.3');
    await loadNaics('2022');

    // Generate Report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalProcessed: globalStats.reduce((acc, s) => acc + s.recordsProcessed, 0),
        totalErrors: globalStats.reduce((acc, s) => acc + s.errors.length, 0),
        totalDurationMs: globalStats.reduce((acc, s) => acc + s.durationMs, 0),
      },
      details: globalStats
    };

    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`Import finished. Report saved to ${REPORT_PATH}`);
  } catch (err) {
    console.error('Fatal import error:', err);
    process.exit(1);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
