import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseCsv(content: string): string[][] {
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

function normalise(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, ' ');
}

function splitAltLabels(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function registerSource(name: string, version: string, provider: string, license: string, url: string) {
  return await prisma.ontologySource.upsert({
    where: { name_version: { name, version } },
    create: { name, version, provider, license, sourceUrl: url },
    update: { provider, license, sourceUrl: url },
  });
}

async function loadEscoOccupations(repoRoot: string) {
  console.log('Loading ESCO Occupations...');
  const filePath = path.join(repoRoot, 'data', 'raw', 'esco', 'v1.2.1', 'occupations_en.csv');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) return;

    const idx = {
      uri: header.indexOf('conceptUri'),
      label: header.indexOf('preferredLabel'),
      altLabels: header.indexOf('altLabels'),
      type: header.indexOf('conceptType'),
      iscoGroup: header.indexOf('iscoGroup'),
    };

    let count = 0;
    for (const row of rows) {
      if (row[idx.type] !== 'Occupation') continue;
      const id = row[idx.uri];
      const label = normalise(row[idx.label] ?? '');
      const iscoCode = row[idx.iscoGroup];
      if (!id || !label) continue;
      
      const alts = splitAltLabels(row[idx.altLabels] ?? '').map(normalise);

      const occ = await prisma.canonicalOccupation.upsert({
        where: { source_sourceId: { source: 'ESCO', sourceId: id } },
        create: {
          canonicalName: label,
          source: 'ESCO',
          sourceId: id,
          sourceVersion: '1.2.1',
          aliases: {
            create: alts.map(alias => ({ alias }))
          }
        },
        update: {
          canonicalName: label,
        }
      });

      if (iscoCode) {
        await prisma.occupationClassificationMapping.upsert({
          where: { occupationId_classificationSystem_externalCode: { 
            occupationId: occ.id, 
            classificationSystem: 'ISCO', 
            externalCode: iscoCode 
          } },
          create: { occupationId: occ.id, classificationSystem: 'ISCO', externalCode: iscoCode },
          update: {}
        });
      }
      count++;
    }
    console.log(`Loaded ${count} ESCO occupations.`);
  } catch (err) {
    console.error('Failed to load ESCO occupations:', err);
  }
}

async function loadEscoSkills(repoRoot: string) {
  console.log('Loading ESCO Skills...');
  const filePath = path.join(repoRoot, 'data', 'raw', 'esco', 'v1.2.1', 'skills_en.csv');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) return;

    const idx = {
      uri: header.indexOf('conceptUri'),
      label: header.indexOf('preferredLabel'),
      altLabels: header.indexOf('altLabels'),
      type: header.indexOf('conceptType'),
      skillType: header.indexOf('skillType'),
    };

    let count = 0;
    for (const row of rows) {
      if (row[idx.type] !== 'KnowledgeSkillCompetence') continue;
      const id = row[idx.uri];
      const label = normalise(row[idx.label] ?? '');
      if (!id || !label) continue;

      const rawType = (row[idx.skillType] ?? '').toLowerCase();
      let type = 'SKILL';
      if (rawType.includes('knowledge')) type = 'KNOWLEDGE';
      else if (rawType.includes('language')) type = 'LANGUAGE';
      else if (rawType.includes('attitude') || rawType.includes('value')) type = 'TRANSVERSAL';

      const alts = splitAltLabels(row[idx.altLabels] ?? '').map(normalise);

      await prisma.canonicalSkill.upsert({
        where: { source_sourceId: { source: 'ESCO', sourceId: id } },
        create: {
          canonicalName: label,
          source: 'ESCO',
          sourceId: id,
          sourceVersion: '1.2.1',
          skillType: type,
          aliases: {
            create: alts.map(alias => ({ alias }))
          }
        },
        update: {
          canonicalName: label,
          skillType: type,
        }
      });
      count++;
    }
    console.log(`Loaded ${count} ESCO skills.`);
  } catch (err) {
    console.error('Failed to load ESCO skills:', err);
  }
}

async function loadOnetOccupations(repoRoot: string) {
  console.log('Loading ONET Occupations...');
  const filePath = path.join(repoRoot, 'data', 'raw', 'onet', 'v30.3', 'job_titles.csv');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) return;

    const idx = {
      code: header.indexOf('O*NET-SOC Code'),
      title: header.indexOf('Title'),
      jobTitle: header.indexOf('Job Title'),
      shortTitle: header.indexOf('Short Title'),
    };

    let count = 0;
    for (const row of rows) {
      const socCode = row[idx.code];
      const title = normalise(row[idx.title] ?? '');
      const jobTitle = normalise(row[idx.jobTitle] ?? '');
      const shortTitle = normalise(row[idx.shortTitle] ?? '');
      if (!socCode) continue;

      const alts = Array.from(new Set([jobTitle, shortTitle].filter(Boolean)));
      const mainLabel = title || jobTitle || shortTitle;
      if (!mainLabel) continue;

      const sourceId = `${socCode}-${jobTitle}`;
      const occ = await prisma.canonicalOccupation.upsert({
        where: { source_sourceId: { source: 'ONET', sourceId } },
        create: {
          canonicalName: mainLabel,
          source: 'ONET',
          sourceId,
          sourceVersion: '30.3',
          aliases: {
            create: alts.map(alias => ({ alias }))
          }
        },
        update: {}
      });

      await prisma.occupationClassificationMapping.upsert({
        where: { occupationId_classificationSystem_externalCode: { 
          occupationId: occ.id, 
          classificationSystem: 'ONET-SOC', 
          externalCode: socCode 
        } },
        create: { occupationId: occ.id, classificationSystem: 'ONET-SOC', externalCode: socCode },
        update: {}
      });
      count++;
    }
    console.log(`Loaded ${count} ONET occupations.`);
  } catch (err) {
    console.error('Failed to load ONET occupations:', err);
  }
}

async function loadCountriesAndZones(repoRoot: string) {
  console.log('Loading Countries and Timezones...');
  try {
    const isoPath = path.join(repoRoot, 'data', 'raw', 'iso', '3166', 'isco3166.csv');
    const isoContent = await fs.readFile(isoPath, 'utf8');
    const isoRows = parseCsv(isoContent);
    const isoHeader = isoRows.shift();
    if (!isoHeader) return;

    const nameIdx = isoHeader.indexOf('name');
    const a2Idx   = isoHeader.indexOf('alpha-2');
    const a3Idx   = isoHeader.indexOf('alpha-3');

    let countryCount = 0;
    for (const row of isoRows) {
      const name = row[nameIdx]?.trim();
      const a2   = row[a2Idx]?.trim();
      const a3   = row[a3Idx]?.trim();
      if (!name || !a2 || !a3) continue;

      await prisma.canonicalCountry.upsert({
        where:  { isoAlpha2: a2 },
        create: { name, isoAlpha2: a2, isoAlpha3: a3 },
        update: { name, isoAlpha3: a3 },
      });
      countryCount++;
    }
    console.log(`Loaded ${countryCount} countries.`);

    const tzPath = path.join(repoRoot, 'data', 'raw', 'timezone', 'latest', 'time_zone.csv');
    try {
      const tzContent = await fs.readFile(tzPath, 'utf8');
      const tzRows = parseCsv(tzContent);
      const tzHeader = tzRows.shift();
      if (tzHeader) {
        const codeIdx = tzHeader.indexOf('country_code');
        const zoneIdx = tzHeader.indexOf('zone_name');
        const cIdx = codeIdx >= 0 ? codeIdx : 1;
        const zIdx = zoneIdx >= 0 ? zoneIdx : 2;

        let tzCount = 0;
        for (const row of tzRows) {
          const code     = row[cIdx]?.trim();
          const zoneName = row[zIdx]?.trim();
          if (!code || !zoneName) continue;

          const country = await prisma.canonicalCountry.findUnique({ where: { isoAlpha2: code } });
          if (!country) continue;

          await prisma.canonicalTimeZone.upsert({
            where:  { zoneName },
            create: { zoneName, countryCode: code },
            update: { countryCode: code },
          });
          tzCount++;
        }
        console.log(`Loaded ${tzCount} timezones.`);
      }
    } catch {
      console.warn('TimeZoneDB not found — skipping timezone import.');
    }
  } catch (err) {
    console.error('Failed to load countries/zones:', err);
  }
}

async function loadNaicsIndustries(repoRoot: string) {
  console.log('Loading NAICS Industries...');
  const filePath = path.join(repoRoot, 'data', 'raw', 'naics', '2022', 'naics-2022-v1.0-isic4-en.csv');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    if (!header) return;

    const naicsCodeIdx  = header.findIndex(h => h.includes('NAICS') && h.toLowerCase().includes('code'));
    const naicsTitleIdx = header.findIndex(h => h.includes('NAICS') && h.toLowerCase().includes('title'));

    const codeIdx  = naicsCodeIdx  >= 0 ? naicsCodeIdx  : 0;
    const titleIdx = naicsTitleIdx >= 0 ? naicsTitleIdx : 1;

    let count = 0;
    for (const row of rows) {
      const code  = row[codeIdx]?.trim();
      const title = row[titleIdx]?.trim();
      if (!code || !title) continue;

      const sourceId = `NAICS:${code}`;
      await prisma.canonicalIndustry.upsert({
        where:  { source_sourceId: { source: 'NAICS', sourceId } },
        create: { code, name: title, source: 'NAICS', sourceId, sourceVersion: '2022' },
        update: { name: title },
      });
      count++;
    }
    console.log(`Loaded ${count} NAICS industries.`);
  } catch (err) {
    console.error('Failed to load NAICS industries:', err);
  }
}

async function loadLanguages(repoRoot: string) {
  console.log('Loading Languages...');
  try {
    const filePath = path.join(repoRoot, 'data', 'raw', 'iso', '639', 'iso_639.csv');
    const content = await fs.readFile(filePath, 'utf8');
    const rows = parseCsv(content);
    const header = rows.shift();
    
    for (const row of rows) {
      if (row.length < 5) continue;
      const iso1 = row[0]?.trim() || '';
      const iso2 = row[1]?.trim() || '';
      const name = row[3]?.trim();
      const native = row[4]?.trim();
      
      if (!iso2 || !name) continue;
      
      await prisma.canonicalLanguage.upsert({
        where: { iso6392: iso2 },
        create: { iso6391: iso1, iso6392: iso2, name, nativeName: native },
        update: { iso6391: iso1, name, nativeName: native }
      });
    }
    console.log(`Loaded Languages.`);
  } catch (err) {
    console.error('Failed to load languages:', err);
  }
}

async function main() {
  const repoRoot = path.resolve(process.cwd());

  // Register Sources
  await registerSource('ESCO', '1.2.1', 'European Commission', 'CC BY 4.0', 'https://esco.ec.europa.eu/');
  await registerSource('O*NET', '30.3', 'U.S. Department of Labor', 'CC BY 4.0', 'https://www.onetcenter.org/');
  await registerSource('ISCO', '08', 'International Labour Organization', 'Public Domain', 'https://www.ilo.org/');
  await registerSource('NAICS', '2022', 'Statistics Canada', 'Open Data', 'https://www.statcan.gc.ca/');

  await loadCountriesAndZones(repoRoot);
  await loadLanguages(repoRoot);

  await loadEscoOccupations(repoRoot);
  await loadEscoSkills(repoRoot);

  await loadOnetOccupations(repoRoot);

  await loadNaicsIndustries(repoRoot);

  console.log('Finished Ontology Import.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
