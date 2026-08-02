# Company Intelligence — Foundation

The Company Intelligence Foundation provides the ingestion layer for company
data in Career Terminal. It covers **providers, storage, normalization,
validation, entity resolution, identifiers and persistence** for company
records sourced from SEC EDGAR, Companies House (UK) and India MCA.

Deliberately **out of scope** for the foundation:

- analytics, scoring, hiring-velocity or any "company intelligence" calculations
- enrichment pipelines (future work)
- any deployment / infrastructure runbook

All provider credentials are **environment-only**. No real keys exist in the
repository — see `.env.example` for placeholders.

---

## 1. Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │                 Import pipeline                │
                    │  plan → create run → fetch → normalize →      │
                    │  validate → resolve → persist → complete      │
                    └────────────────────────────────────────────────┘
                       ▲              │           ▲         │
          ProviderCompanyRecord      │   NormalizedCompanyData
                       │              ▼           │         ▼
   ┌───────────────────┴───┐   ┌────────────┐ ┌──┴──────────┴────┐
   │    CompanyProvider     │   │  Record    │ │  Entity resolver  │
   │  (SEC / CH / MCA / …)  │──▶│ normalizer │ │  + repository     │
   └───────────────────────┘    └────────────┘ └───────────────────┘
            │                                    Prisma / In-memory
            ▼
   CompanyDataStorage (local filesystem or S3) + HttpDataSource
```

All code lives under `src/services/company-intelligence/`:

| Directory     | Responsibility                                              |
| ------------- | ----------------------------------------------------------- |
| `providers/`  | `CompanyProvider` interface, SEC/Companies House/India MCA, registry |
| `importers/`  | Import planner + `CompanyImporter` pipeline, job payload contract |
| `normalization/` | Provider-agnostic name/domain/country/jurisdiction/ticker/timestamp normalizers + record normalizer |
| `validation/` | `CompanyValidator` with error/warning issue reporting        |
| `entities/`   | `CompanyEntityResolver` (identifier → domain → website → name) |
| `identifiers/`| Identifier type catalogue, per-type validators, required identifiers |
| `repository/` | `CompanyIntelRepository` contract, Prisma + in-memory implementations |
| `storage/`    | `CompanyDataStorage` abstraction (local / S3), `HttpDataSource` |
| `config/`     | Typed config + retry policy derived from env                |

## 2. Providers

Every source implements `CompanyProvider`
(`src/services/company-intelligence/providers/company-provider.types.ts`):

- `key` / `name` / `version` / `jurisdiction` / `capabilities`
- `enabled` — driven by configuration
- `isAvailable()` — config present + dataset/API reachable
- `fetchRecords(options)` — **async generator** of `ProviderCompanyRecord`
- `health()` — `healthy | degraded | unhealthy | unknown`

The generator contract is important: providers **never perform large imports
themselves**. They stream records and the pipeline consumes them one at a time,
so memory stays bounded for bulk datasets (SEC full-submissions, MCA company
master, CH streaming).

Built-in providers:

- **SEC EDGAR** (`sec`) — reads staged submissions datasets through
  `CompanyDataStorage` (no download). Optional: when disabled or datasets are
  missing, the pipeline logs a structured message and continues.
- **Companies House** (`companies-house`) — REST (profile + search) and the
  streaming API for incremental (`since`) runs.
- **India MCA** (`india-mca`) — data.gov.in resource API with offset pagination.

Provider keys are stable: `sec`, `companies-house`, `india-mca`.

### 2.1 Registry

`CompanyProviderRegistry` (`providers/registry.ts`) catalogs providers and
answers `get / all / enabled / isEnabled`. `createDefaultRegistry()` wires the
three providers to the configured storage and env-only credentials. The
registry never decides whether a provider runs — that is the import planner's
job.

## 3. Storage abstraction

Providers read datasets exclusively through `CompanyDataStorage`
(`storage/storage.types.ts`):

```
read / readText / write / list / exists / openStream
```

Backends:

- `local` — `LocalFilesystemStorage`, root `COMPANY_INTEL_LOCAL_DATA_DIR`
  (default `./data/company-intel`), with path-traversal guards.
- `s3` — `S3Storage`, bucket + prefix from `COMPANY_INTEL_S3_*`, endpoint for
  MinIO-style object stores.

The backend is selected purely by `COMPANY_INTEL_STORAGE_BACKEND`; providers
and the pipeline reference only the interface. **Switching to S3 (or a future
backend) requires configuration only — no code changes.**

URIs are logical paths relative to the backend root, e.g.
`sec/full-submissions/2024/1/0000320193.json`.

HTTP/API providers share `HttpDataSource` (`storage/http-client.ts`): token
bucket rate limiting, retry with exponential backoff + `Retry-After` support,
timeouts, and per-provider headers (e.g. basic auth for Companies House).

## 4. Import pipeline

`importers/company-importer.ts`:

1. **Plan** (`import-planner.ts`) — skip reasons: `provider-not-found`,
   `provider-disabled`, `provider-unavailable`, `mode-unsupported`; otherwise a
   scheduled run with a `nextRunAt` cadence.
2. **Create run** — `CompanyImportRun` row (RUNNING).
3. **Fetch** — consume the provider generator.
4. **Per record**: normalize → validate → resolve → persist, recording
   provider-record provenance and audit logs. Validation failures and
   resolution conflicts are counted and logged, never aborting the run.
5. **Complete** — status `success | partial | failed | skipped`, counts, error
   message, and provider metadata (`lastRunAt`, `lastRunStatus`, …).

`executeImportJob(job)` accepts `ImportJobPayload`, so a future BullMQ worker
can be wired with no pipeline changes.

### 4.1 Dry-run

`ImportRunOptions.dryRun` validates + resolves but does not persist. For fully
non-durable dry runs, pass an `InMemoryCompanyIntelRepository` — the in-memory
implementation mirrors the Prisma behavior so dry-run counts are realistic.

## 5. Normalization & validation

- **Record normalizer** (`normalization/record-normalizer.ts`) maps
  `CompanyRawData` → `NormalizedCompanyData`: canonical name key (legal
  suffixes stripped), domain derivation from website, jurisdiction parsing to
  canonical codes, identifier normalization and a SHA-256 checksum.
- **Validator** (`validation/company.validator.ts`) returns `error`/`warning`
  issues: missing required identifiers per provider (SEC→CIK, CH→company
  number, MCA→CIN), invalid domains/country codes, duplicate identifiers,
  invalid temporal ranges, future timestamps, malformed URLs, etc.

## 6. Entity resolution

`entities/entity-resolution.ts` matches an incoming record to a canonical
company with this priority:

1. **Identifiers** (registration numbers, LEI, CIK, …) — strongest; some types
   (`lei`, `cik`) are globally unique and matched without a jurisdiction scope.
2. **Normalized apex domain**
3. **Normalized website URL**
4. **Exact normalized name + jurisdiction** (weakest)

Once a strong signal (identifier/domain) matches, weaker signals are skipped.
Conflicting signals raise `EntityResolutionConflictError`, which the pipeline
records and skips the record.

Canonical companies are stored in a separate namespace
(`canonicalCompanies` + child tables) decoupled from user-scoped `Company`
rows; an optional unique 1:1 link (`canonicalCompanies.company_id`) is
`SetNull` on delete.

## 7. Configuration

All variables are validated in
`src/infrastructure/config/env.schema.ts` and surfaced via
`config.companyIntelligence` / `config.companyProviders`
(`src/config/index.ts`). See `.env.example` for the full annotated list.
Highlights:

- `COMPANY_INTEL_STORAGE_BACKEND` — `local` | `s3`
- `COMPANY_INTEL_LOCAL_DATA_DIR`, `COMPANY_INTEL_S3_*`
- `SEC_PROVIDER_ENABLED`, `SEC_DATA_DIR`, `SEC_USER_AGENT`, …
- `COMPANIES_HOUSE_PROVIDER_ENABLED`, `COMPANIES_HOUSE_API_KEY`,
  `COMPANIES_HOUSE_STREAMING_API_KEY`, …
- `INDIA_MCA_PROVIDER_ENABLED`, `INDIA_MCA_API_KEY`, `INDIA_MCA_RESOURCE_ID`, …

## 8. Adding a new provider

1. Create `providers/<name>.provider.ts` implementing `CompanyProvider`
   (`fetchRecords` as an async generator emitting `ProviderCompanyRecord`).
   Source data via `CompanyDataStorage` and/or `HttpDataSource`.
2. Add config fields to `env.schema.ts`, `AppConfig` in `src/config/index.ts`,
   `.env.example`, and the `build<X>ProviderConfig` factory.
3. Register the instance in `createDefaultRegistry()`.
4. If it introduces a new required identifier, extend
   `REQUIRED_IDENTIFIERS_BY_PROVIDER` in `identifiers/identifier-types.ts`.
5. Add unit tests under `src/services/company-intelligence/__tests__/`.

## 9. Database

Schema lives in `prisma/schema.prisma` (models prefixed `CanonicalCompany`,
`Company*`); the migration is
`prisma/migrations/20260801000000_add_company_intelligence_foundation/`.
Identifier `type` and `status` strings are free-form so new identifier types
and provider statuses need no migration.

## 10. Future work (not in this foundation)

- BullMQ wiring for scheduled/queued imports (`ImportJobPayload` is ready).
- S3 dataset staging tooling (config-only switch already supported).
- Enrichment, analytics, scoring and company-intelligence calculations.
