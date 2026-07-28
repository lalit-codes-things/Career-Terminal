# Global Career Intelligence Data Platform Audit

This document provides a comprehensive audit of all external datasets currently present in the Career Terminal repository. It evaluates their current usage, future roadmap alignment, and provides strategic recommendations for their integration into the production-grade Global Career Intelligence Data Platform.

## 1. ESCO (European Skills, Competences, Qualifications and Occupations)

**Dataset:** ESCO
**Version:** v1.2.1
**Provider:** European Commission
**License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
**Files:** `ESCO dataset - v1.2.1 - classification - en - csv/` (occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv, etc.)
**Current usage:** Only basic occupations and skills are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Epic 4 (Resume intelligence), Epic 9 (Career intelligence), Epic 12 (AI career reasoning). Will serve as a core pillar for occupation hierarchy, skill relationships, digital/green/transversal skills, and knowledge concepts.
**Recommended action:** **ACTIVE** / **STRATEGIC**. Move to `data/raw/esco/v1.2.1/`. Expand integration to include full hierarchies and relationships, mapping ESCO occupations to the Career Terminal canonical model.

## 2. O*NET (Occupational Information Network)

**Dataset:** O*NET Database
**Version:** 30.3
**Provider:** U.S. Department of Labor / Employment and Training Administration
**License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
**Files:** `ONET dataset/db_30_3_csv/` (job_titles.csv, essential_skills.csv, task_statements.csv, abilities.csv, etc.)
**Current usage:** Only basic occupations and essential skills are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Interview intelligence, Career recommendations, Role understanding. Will provide deep insights into tasks, abilities, work activities, technology skills, and education/experience requirements.
**Recommended action:** **ACTIVE** / **STRATEGIC**. Move to `data/raw/onet/v30.3/`. Expand integration to create `occupation_tasks`, `occupation_requirements`, and `occupation_technology_skills` tables, mapping O*NET occupations to the Career Terminal canonical model.

## 3. ISCO (International Standard Classification of Occupations)

**Dataset:** ISCO
**Version:** Latest (ISCO-08)
**Provider:** International Labour Organization (ILO)
**License:** Open Data / Public Domain (ILO terms)
**Files:** `isco.csv`
**Current usage:** Not actively imported in the current `import-ontology.ts` script, but present in the repository.
**Future roadmap usage:** Will become the global occupation backbone, serving as the top-level identity layer connecting ESCO and O*NET. Crucial for international job normalization, global labor analytics, country comparison, and migration intelligence.
**Recommended action:** **STRATEGIC**. Move to `data/raw/isco/latest/`. Do NOT delete. Implement as the global occupation layer with `occupation_classification_mapping` to link ESCO and O*NET codes.

## 4. NAICS (North American Industry Classification System)

**Dataset:** NAICS
**Version:** 2022 (v1.0 ISIC4 mapping)
**Provider:** Statistics Canada / US Census Bureau / INEGI
**License:** Open Data / Public Domain
**Files:** `naics-2022-v1.0-isic4-en.csv`
**Current usage:** Basic industry codes and titles are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Epic 5 (Company Intelligence), Epic 10 (Market Intelligence). Will support mapping companies to industries, and subsequently to occupation demand and skills.
**Recommended action:** **ACTIVE** / **STRATEGIC**. Move to `data/raw/naics/2022/`. Create `industry_classification_mapping` to support the Company -> Industry -> Occupation demand -> Skills intelligence chain.

## 5. ISO 3166 (Country Codes)

**Dataset:** ISO 3166
**Version:** Latest
**Provider:** International Organization for Standardization (ISO)
**License:** Open Data / Public Domain (Standard reference)
**Files:** `isco3166.csv`
**Current usage:** Alpha-2, Alpha-3 codes, and country names are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Essential for defining countries, regions, labor markets, and ensuring international compliance across the platform.
**Recommended action:** **ACTIVE**. Move to `data/raw/iso/3166/`. Maintain as the canonical source for country and region identification.

## 6. ISO 639 (Language Codes)

**Dataset:** ISO 639
**Version:** Latest
**Provider:** International Organization for Standardization (ISO)
**License:** Open Data / Public Domain (Standard reference)
**Files:** `iso_639.csv`
**Current usage:** ISO 639-1, 639-2 codes, and language names are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Required for resume languages, multi-region deployment, and internationalization of the platform.
**Recommended action:** **ACTIVE**. Move to `data/raw/iso/639/`. Maintain as the canonical source for language identification.

## 7. ISO 4217 (Currency Codes)

**Dataset:** ISO 4217
**Version:** Latest
**Provider:** International Organization for Standardization (ISO)
**License:** Open Data / Public Domain (Standard reference)
**Files:** `iso4217.csv`
**Current usage:** Currently present in the repository but not imported in `import-ontology.ts`.
**Future roadmap usage:** Epic 7 (Compensation Intelligence). Will be required for standardizing salary data, compensation analysis, and global labor market intelligence.
**Recommended action:** **STRATEGIC**. Move to `data/raw/iso/4217/`. Integrate into the canonical ontology model (`canonical_currencies`) to support compensation intelligence.

## 8. TimeZoneDB

**Dataset:** TimeZoneDB
**Version:** Latest
**Provider:** TimeZoneDB
**License:** Creative Commons Attribution 3.0 License (CC BY 3.0)
**Files:** `TimeZoneDB.csv` (Note: Currently a CSV file, but script expects a directory `TimeZoneDB.csv/time_zone.csv`. Needs structural correction).
**Current usage:** Timezone names and country mappings are imported via `scripts/import-ontology.ts`.
**Future roadmap usage:** Required for user profiles, scheduling, and global event coordination across the platform.
**Recommended action:** **ACTIVE**. Move to `data/raw/timezone/latest/`. Fix the file/directory structure discrepancy and maintain as the canonical source for timezones (`canonical_timezones`).

---

## Summary of Classifications

| Dataset | Classification | Primary Purpose |
| :--- | :--- | :--- |
| ESCO | **ACTIVE** / **STRATEGIC** | European skills, occupations, and relationships |
| O*NET | **ACTIVE** / **STRATEGIC** | US occupational requirements, tasks, and abilities |
| ISCO | **STRATEGIC** | Global occupation backbone and normalization |
| NAICS | **ACTIVE** / **STRATEGIC** | Industry classification and market intelligence |
| ISO 3166 | **ACTIVE** | Country and region standardization |
| ISO 639 | **ACTIVE** | Language standardization |
| ISO 4217 | **STRATEGIC** | Currency standardization for compensation |
| TimeZoneDB | **ACTIVE** | Global timezone standardization |

*Note: No datasets have been classified as DELETE. All datasets provide strategic value for the Global Career Intelligence Data Platform.*
