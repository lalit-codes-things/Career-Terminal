# Global Career Intelligence Data Platform: Data Architecture and Migration Plan

This document outlines the proposed professional data architecture for the Global Career Intelligence Data Platform, focusing on the organization and placement of external datasets. This architecture is designed to support scalability, maintainability, and compliance for a platform targeting 1 billion users and billions of career events.

## 1. New Data Directory Structure

The existing practice of scattering dataset files across the repository will be replaced with a centralized and structured `data/` directory. This structure ensures clear separation of raw, processed, and metadata files, facilitating easier management and future expansion.

```
data/
├── raw/
│   ├── esco/
│   │    └── v1.2.1/
│   ├── onet/
│   │    └── v30.3/
│   ├── isco/
│   │    └── latest/
│   ├── naics/
│   │    └── 2022/
│   ├── iso/
│   │    ├── 3166/
│   │    ├── 639/
│   │    └── 4217/
│   └── timezone/
│        └── latest/
├── processed/
├── manifests/
└── documentation/
```

### 1.1. `data/raw/`

This directory will store all original, untransformed external datasets. Each dataset will reside in its own subdirectory, typically organized by provider and version. This ensures the preservation of the raw source data, which is crucial for data provenance and re-processing if needed.

*   **`data/raw/esco/v1.2.1/`**: Contains all files from the ESCO v1.2.1 dataset.
*   **`data/raw/onet/v30.3/`**: Contains all files from the O*NET 30.3 dataset.
*   **`data/raw/isco/latest/`**: Contains the `isco.csv` file.
*   **`data/raw/naics/2022/`**: Contains the `naics-2022-v1.0-isic4-en.csv` file.
*   **`data/raw/iso/3166/`**: Contains the `isco3166.csv` file.
*   **`data/raw/iso/639/`**: Contains the `iso_639.csv` file.
*   **`data/raw/iso/4217/`**: Contains the `iso4217.csv` file.
*   **`data/raw/timezone/latest/`**: Contains the `time_zone.csv` file (after correcting the directory structure issue).

### 1.2. `data/processed/`

This directory will store datasets after they have undergone initial processing, cleaning, or transformation. This includes data that has been normalized, enriched, or prepared for ingestion into the database. The structure within this directory will mirror the `raw` directory, maintaining clear lineage.

### 1.3. `data/manifests/`

This directory will contain metadata files, checksums, and other artifacts that describe the datasets. These manifests are critical for data governance, ensuring data integrity, and tracking changes over time. They will be integral to the data provenance system.

### 1.4. `data/documentation/`

This directory will house documentation specific to the datasets, such as schema definitions, data dictionaries, usage guidelines, and any specific notes regarding data quality or transformation rules.

## 2. Data Placement Rules

To maintain a clean, organized, and production-grade data platform, the following rules will be strictly enforced:

*   **No random CSV files in repository root**: All external data files must reside within the `data/` directory structure.
*   **No duplicated datasets**: Each unique dataset version should exist only once in the `data/raw/` directory.
*   **No temporary database dumps**: Database backups or temporary data exports should not be stored within this data architecture. Dedicated backup and restore procedures will be established separately.
*   **Preserve raw source data**: The `data/raw/` directory is immutable. Original downloaded files must not be modified. Any transformations or cleaning should result in new files placed in `data/processed/`.

## 3. Migration Plan

The migration to this new architecture will involve the following steps:

1.  **Create the `data/` directory structure**: Establish `raw/`, `processed/`, `manifests/`, and `documentation/` subdirectories, along with the specific dataset subdirectories under `raw/`.
2.  **Move existing datasets**: Relocate all current external dataset files (ESCO, O*NET, ISCO, NAICS, ISO, TimeZoneDB) from their current locations into their respective `data/raw/{provider}/{version}/` directories.
3.  **Update import scripts**: Modify `scripts/import-ontology.ts` and any other relevant scripts to reflect the new file paths for accessing the raw datasets.
4.  **Address TimeZoneDB structure**: Correct the `TimeZoneDB.csv` file to be `TimeZoneDB.csv/time_zone.csv` if it's a directory containing the CSV, or rename the file to `time_zone.csv` and place it in `data/raw/timezone/latest/` if it's a standalone CSV file.
5.  **Implement checksums and manifests**: As part of Phase 3, a data provenance system will be built, which will include generating and storing checksums and other metadata in the `data/manifests/` directory for each raw dataset.

This structured approach ensures that the data foundation is robust, auditable, and ready to support the ambitious roadmap of the Career Terminal platform.
