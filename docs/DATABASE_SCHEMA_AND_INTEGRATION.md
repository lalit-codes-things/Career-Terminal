# Global Career Intelligence Data Platform: Database Schema and Integration Specifications

This document details the proposed database schema enhancements, data provenance system, expanded ontology models, and integration specifications for various external datasets, covering Phases 3 through 9 of the Global Career Intelligence Data Platform development.

## 1. Phase 3 — Build Data Provenance System

To ensure the traceability and auditability of all intelligence signals, a robust data provenance system will be implemented. This involves creating a dedicated table to track the origin of each dataset and modifying existing canonical entities to preserve source information.

### 1.1. `ontology_sources` Table

This new table will store metadata about each external data source, allowing for comprehensive tracking of versions, providers, licenses, and import details.

| Field Name | Data Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Unique identifier for the data source. |
| `name` | String | Human-readable name of the dataset (e.g., "ESCO"). |
| `provider` | String | Organization or entity providing the dataset (e.g., "European Commission"). |
| `version` | String | Version identifier of the dataset (e.g., "1.2.1"). |
| `source_url` | String | URL where the original dataset can be accessed or downloaded. |
| `license` | String | Licensing terms of the dataset (e.g., "CC BY 4.0"). |
| `checksum` | String | Hash of the raw dataset file(s) to verify integrity. |
| `import_date` | DateTime | Timestamp of when the dataset was first imported. |
| `created_at` | DateTime | Timestamp of record creation. |

**Example Entry:**

```
name: ESCO
provider: European Commission
version: 1.2.1
source_url: https://esco.ec.europa.eu/en/use-esco/download
license: Creative Commons Attribution 4.0 International
checksum: <calculated_checksum>
import_date: 2026-07-28T10:00:00Z
```

### 1.2. Source Preservation in Canonical Entities

Every imported canonical entity (e.g., `canonical_skill`, `canonical_occupation`) must preserve the following fields to link back to its original source:

*   `source_id`: The unique identifier of the entity within its original dataset (e.g., ESCO concept URI, O*NET-SOC Code).
*   `external_identifier`: A secondary identifier from the source, if applicable, to ensure uniqueness or provide additional context.
*   `source_version`: The version of the source dataset from which the entity was imported.

**Example for `canonical_skill`:**

```
id: <uuid>
canonicalName: software development
source: ESCO
sourceId: http://data.europa.eu/esco/skill/S1.1.1
external_identifier: skill_123 (if applicable)
sourceVersion: 1.2.1
```

This approach ensures that future audits can trace the origin of every piece of intelligence, supporting data quality, compliance, and update mechanisms.

## 2. Phase 4 — Redesign Ontology Model

The existing ontology model will be significantly expanded to cover a broader range of career intelligence facets and to establish rich relationships between them. This redesign is crucial for supporting advanced features like resume matching, career path analysis, skill gap identification, labor intelligence, and AI reasoning.

### 2.1. Expanded Canonical Tables

In addition to `canonical_skills` and `canonical_occupations`, the following canonical tables will be introduced or enhanced:

*   `canonical_industries`
*   `canonical_countries`
*   `canonical_languages`
*   `canonical_currencies`
*   `canonical_timezones`

These tables will serve as the single source of truth for these entities within the Career Terminal platform, each maintaining its `source`, `sourceId`, and `sourceVersion` for provenance.

### 2.2. New Relationship Tables

To capture the complex interdependencies within career intelligence, several new relationship tables will be created:

#### 2.2.1. `occupation_skill`

Links occupations to the skills required or associated with them.

| Field Name | Data Type | Description |
| :--- | :--- | :--- |
| `occupation_id` | UUID | Foreign key to `canonical_occupations`. |
| `skill_id` | UUID | Foreign key to `canonical_skills`. |
| `importance` | Integer | (Optional) Rating of skill importance for the occupation. |
| `confidence` | Decimal | (Optional) Confidence score of the relationship. |
| `source_id` | UUID | Foreign key to `ontology_sources` for provenance. |

#### 2.2.2. `skill_relationship`

Defines relationships between different skills (e.g., prerequisite, related, broader/narrower).

| Field Name | Data Type | Description |
| :--- | :--- | :--- |
| `skill_a` | UUID | Foreign key to `canonical_skills` (first skill). |
| `skill_b` | UUID | Foreign key to `canonical_skills` (second skill). |
| `relationship_type` | Enum/String | Type of relationship (e.g., `BROADER`, `NARROWER`, `RELATED`, `PREREQUISITE`). |
| `confidence` | Decimal | (Optional) Confidence score of the relationship. |
| `source_id` | UUID | Foreign key to `ontology_sources` for provenance. |

#### 2.2.3. `occupation_hierarchy`

Establishes hierarchical relationships between occupations (e.g., parent-child).

| Field Name | Data Type | Description |
| :--- | :--- | :--- |
| `parent_occupation_id` | UUID | Foreign key to `canonical_occupations` (parent). |
| `child_occupation_id` | UUID | Foreign key to `canonical_occupations` (child). |
| `source_id` | UUID | Foreign key to `ontology_sources` for provenance. |

#### 2.2.4. `occupation_classification_mapping`

Maps Career Terminal canonical occupations to external classification systems like ISCO, ESCO, and O*NET.

| Field Name | Data Type | Description |
| :--- | :--- | :--- |
| `occupation_id` | UUID | Foreign key to `canonical_occupations`. |
| `classification_system` | String | Name of the external classification system (e.g., "ISCO", "ESCO", "O*NET"). |
| `external_code` | String | The code or identifier in the external system. |
| `source_id` | UUID | Foreign key to `ontology_sources` for provenance. |

## 3. Phase 5 — ESCO Integration

The integration of ESCO will move beyond basic occupations and skills to leverage its rich hierarchical and relational data, providing a deeper understanding of European labor market dynamics.

### 3.1. Expanded ESCO Data Integration

Beyond occupations and skills, the following ESCO concepts will be evaluated and integrated:

*   **Occupation Hierarchy**: Integrate parent-child relationships between ESCO occupations into `occupation_hierarchy`.
*   **Skill Relationships**: Incorporate ESCO's skill-to-skill relationships into `skill_relationship`.
*   **Digital Skills**: Identify and categorize digital skills from ESCO.
*   **Green Skills**: Identify and categorize green skills from ESCO.
*   **Transversal Skills**: Integrate transversal skills (e.g., communication, problem-solving).
*   **Knowledge Concepts**: Integrate knowledge concepts as a type of skill or a separate entity if warranted.

### 3.2. ESCO to Career Terminal Occupation Mapping

A robust mapping mechanism will be established to link ESCO occupations to the Career Terminal's canonical occupation model. This will primarily utilize the `occupation_classification_mapping` table, ensuring that external ESCO identifiers are preserved and linked to internal canonical IDs.

**Mapping Flow:**

`ESCO occupation` → `Career Terminal occupation`

**Key Principles:**

*   **No data duplication**: ESCO data will be integrated into the canonical model, not duplicated.
*   **Preserve external IDs**: Original ESCO concept URIs will be stored as `source_id` in canonical tables and `external_code` in mapping tables.

**Future Usage:** This enhanced ESCO integration will be critical for Epic 4 (Resume intelligence), Epic 9 (Career intelligence), and Epic 12 (AI career reasoning), providing a nuanced understanding of European skill and occupation landscapes.

## 4. Phase 6 — O*NET Integration

O*NET provides detailed occupational information for the U.S. labor market. Its integration will enrich the Career Terminal's understanding of job requirements, tasks, and necessary attributes.

### 4.1. Expanded O*NET Data Integration

The following O*NET data elements will be evaluated and integrated:

*   **Tasks**: Detailed work activities performed in an occupation.
*   **Abilities**: Enduring attributes of the individual that influence performance.
*   **Knowledge**: Organized sets of principles and facts applying to a wide range of problems.
*   **Work Activities**: General types of job behaviors occurring in many jobs.
*   **Technology Skills**: Specific computer and technology-related skills.
*   **Education Requirements**: Typical education needed for an occupation.
*   **Experience Requirements**: Typical experience needed for an occupation.

### 4.2. New O*NET-Specific Tables

To store the granular data provided by O*NET, the following tables will be created:

*   `occupation_tasks`: Links occupations to specific tasks.
*   `occupation_requirements`: Stores education and experience requirements for occupations.
*   `occupation_technology_skills`: Links occupations to required technology skills.

### 4.3. O*NET to Career Terminal Occupation Mapping

Similar to ESCO, O*NET occupations will be mapped to the Career Terminal's canonical occupation model using the `occupation_classification_mapping` table.

**Mapping Flow:**

`O*NET occupation` → `Career Terminal occupation`

**Future Usage:** This integration will be vital for Interview intelligence, Career recommendations, and a deeper Role understanding, particularly within the U.S. context.

## 5. Phase 7 — ISCO Global Occupation Layer

ISCO will serve as the foundational global occupation backbone, providing a standardized framework to which regional and national classifications (like ESCO and O*NET) can be mapped. This is critical for international comparability and global labor analytics.

### 5.1. ISCO as Global Backbone

ISCO will not be deleted but will be elevated to a central role in the data architecture:

```
                 ISCO
                  |
      Global Occupation Identity
            /            \
         ESCO          O*NET
```

This architecture ensures that all regional occupation data can be normalized and compared through a common global standard.

### 5.2. `occupation_classification_mapping` for ISCO

The `occupation_classification_mapping` table will be extensively used to link Career Terminal canonical occupations to their corresponding ISCO codes, as well as to ESCO and O*NET codes.

**Example Mapping:**

`Software Developer`

*   `ISCO`: 2512
*   `ESCO`: software developer (concept URI)
*   `O*NET`: 15-1252

**Purpose:** This global layer enables international job normalization, global labor analytics, country comparison, and migration intelligence, supporting a truly global career intelligence platform.

## 6. Phase 8 — Industry Intelligence

Integration of NAICS will provide a robust framework for industry classification, enabling the platform to understand and analyze industry-specific trends, company intelligence, and occupation demand.

### 6.1. NAICS Integration

NAICS (North American Industry Classification System) will be integrated to classify companies and understand industry structures.

### 6.2. `industry_classification_mapping` Table

A new table, `industry_classification_mapping`, will be created to link Career Terminal canonical industries to external classification systems like NAICS.

**Mapping Flow:**

`Company` → `Industry` → `Occupation demand` → `Skills`

**Future Usage:** This will be crucial for Epic 5 (Company Intelligence) and Epic 10 (Market Intelligence), allowing for detailed analysis of industry-specific career dynamics.

## 7. Phase 9 — Global Standard Data (ISO & TimeZoneDB)

This phase focuses on integrating and maintaining global standard datasets for countries, languages, currencies, and timezones, which are fundamental for international operations and compliance.

### 7.1. ISO 3166 (Country Codes)

*   **Purpose**: Provides standardized codes for countries and their subdivisions. Essential for defining geographical scope, labor markets, and ensuring international compliance.
*   **Integration**: `canonical_countries` table will store ISO Alpha-2, Alpha-3 codes, and country names.

### 7.2. ISO 639 (Language Codes)

*   **Purpose**: Provides standardized codes for the representation of names of languages. Critical for resume language identification, multi-language support, and internationalization.
*   **Integration**: `canonical_languages` table will store ISO 639-1, 639-2 codes, and language names.

### 7.3. ISO 4217 (Currency Codes)

*   **Purpose**: Provides internationally recognized codes for currencies. Indispensable for compensation intelligence, salary standardization, and financial analytics.
*   **Integration**: A new `canonical_currencies` table will be created to store currency codes and related information.

### 7.4. TimeZoneDB

*   **Purpose**: Provides a comprehensive database of time zones. Necessary for user profiles, scheduling, and coordinating global events and data processing.
*   **Integration**: `canonical_timezones` table will store timezone names and their associated country codes, linked to `canonical_countries`.

These global standard datasets form the bedrock for ensuring the platform's international capabilities and data consistency across diverse geographical and linguistic contexts.
