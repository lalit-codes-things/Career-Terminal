# Graph Report - .  (2026-08-02)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2868 nodes · 6509 edges · 202 communities (122 shown, 80 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- providers/index.ts
- malware-scan.worker.ts
- normalization/index.ts
- rule-based-classifier.ts
- providers/registry.ts
- lifecycle-manager.ts
- prisma
- candidate-intelligence/index.ts
- rate-limiter.ts
- UserService
- outcome.service.ts
- CompanyProvider
- prisma-company-intel.repository.ts
- dashboard.service.ts
- AppError
- job-intelligence/index.ts
- src/index.ts
- event.types.ts
- app-errors.ts
- S3StorageService
- opportunity.service.ts
- health.service.ts
- recruiter.service.ts
- NormalizedCompanyData
- application-query.service.ts
- logger.ts
- classification.test.ts
- ownership.guard.ts
- application-tracking.service.ts
- encryption.ts
- database.ts
- gmail-ingestion.service.ts
- InMemoryStateBackend
- QueueService
- gmail-client.ts
- action.service.ts
- CompanyProviderRegistry
- PrismaCompanyIntelRepository
- scanner.factory.ts
- scripts
- compilerOptions
- src/config/index.ts
- epic-0.7-privacy.test.ts
- placement.service.ts
- resume-versioning.service.test.ts
- JobApplicationExtractor
- ApplicationStatus
- authenticity/engine.ts
- identifier-types.ts
- health/engine.ts
- secret-provider.ts
- applications.routes.ts
- CompanyIntelligenceApiService
- queue.service.ts
- idempotency.service.ts
- ProviderHealthTracker
- IndiaMcaProvider
- market-identity/engine.ts
- RelationshipEngine
- SnapshotService
- devDependencies
- import-ontology.ts
- base.repository.ts
- CompaniesHouseProvider
- entity-resolution.ts
- geographic/engine.ts
- GmailClient
- rls.ts
- application-timeline.service.ts
- resume-upload.service.ts
- contracts/index.ts
- timeline/engine.ts
- resume-matcher.service.ts
- enrichment/engine.ts
- rules
- redis.ts
- canonical-role.ts
- recommendation.service.ts
- metrics.ts
- CareerTaxonomyService
- errors.ts
- country.ts
- DurableCheckpointService
- email-parser.service.ts
- hiring/engine.ts
- ExtractionRunService
- placement.ts
- resume.routes.ts
- companies.routes.ts
- outbox-dispatcher.service.ts
- ICacheService
- googleapis-shim.ts
- career-preferences.ts
- middleware.ts
- IStorageService
- ApplicationTimelineService
- PlacementService
- company.service.ts
- company-signal.service.ts
- KMSCryptoService
- userOwnershipFilter
- ResumeMatcherService
- .eslintrc.json
- application-command.service.ts
- ClassificationSystem
- CompanyService
- CompanyIntelRepository
- GmailIngestionService
- OwnershipGuard
- ignorePatterns
- DatabaseRouter
- analytics.service.ts
- storage/index.ts
- S3Storage
- GmailOAuthService
- canonical-intelligence.service.ts
- ai-data-protection.ts
- opportunity.service.test.ts
- LocalFilesystemStorage
- gmail-ingestion-coordinator.ts
- backfill-application-resumes.ts
- validate-k8s-images.js
- ProvenanceRecord
- RedisCacheService
- backfill-placement.ts
- internal-api.ts
- CompanyDataStorage
- DeletionService
- embedding.service.ts
- dependencies
- package.json
- CircuitBreaker
- ICryptoService
- NullCacheService
- resume-parser.service.ts
- CellService
- job-analytics.service.ts
- googleapis-recommender-shim.d.ts
- embeddings.ts
- epic-0.7-encryption.test.ts
- parserOptions
- substitute-k8s-digests.sh
- bullmq.types.ts
- types
- typeRoots
- paths
- test-bootstrap.sh
- encryption.test.ts
- express-request.d.ts
- @aws-sdk/client-kms
- @aws-sdk/client-s3
- @aws-sdk/s3-request-presigner
- blocked-at
- bullmq
- compression
- cors
- init-bucket.sh
- 01-create-app-roles.sh
- 02-create-shadow-db.sh
- dotenv
- express
- googleapis
- helmet
- http-terminator
- ioredis
- jsonwebtoken
- multer
- @opentelemetry/exporter-prometheus
- @opentelemetry/exporter-trace-otlp-http
- @opentelemetry/instrumentation-express
- @opentelemetry/resources
- @opentelemetry/sdk-metrics
- @opentelemetry/sdk-node
- @opentelemetry/sdk-trace-node
- @opentelemetry/semantic-conventions
- pdf-parse
- prom-client
- rate-limiter-flexible
- @types/jsonwebtoken
- uuid
- zod
- supertest
- ts-jest
- tsx
- @types/compression
- @types/cors
- @types/express
- @types/jest
- @types/multer
- @types/node
- @types/pg
- @types/supertest
- @typescript-eslint/eslint-plugin
- @typescript-eslint/parser
- blocked-at.d.ts
- canonical-intelligence.test.ts

## God Nodes (most connected - your core abstractions)
1. `prisma` - 89 edges
2. `Logger` - 79 edges
3. `config` - 38 edges
4. `userOwnershipFilter()` - 38 edges
5. `NormalizedCompanyData` - 33 edges
6. `CompanyProvider` - 30 edges
7. `ClassifiableEmail` - 30 edges
8. `ApplicationStatus` - 29 edges
9. `CompanyProviderRegistry` - 29 edges
10. `GmailClient` - 28 edges

## Surprising Connections (you probably didn't know these)
- `executeWithTransientRetry()` --references--> `@prisma/client`  [EXTRACTED]
  src/db/transaction-utils.ts → package.json
- `attachRlsMiddleware()` --references--> `@prisma/client`  [EXTRACTED]
  src/middleware/rls.ts → package.json
- `withPrivilegedTransaction()` --references--> `@prisma/client`  [EXTRACTED]
  src/middleware/rls.ts → package.json
- `withRlsTransaction()` --references--> `@prisma/client`  [EXTRACTED]
  src/middleware/rls.ts → package.json
- `backfillPlacement()` --calls--> `computeShardKey()`  [EXTRACTED]
  scripts/backfill/backfill-placement.ts → src/services/placement/placement.service.ts

## Import Cycles
- 3-file cycle: `src/services/application-command/application-command.service.ts -> src/services/application-merge/application-merge.service.ts -> src/services/application-tracking/application-tracking.service.ts -> src/services/application-command/application-command.service.ts`
- 3-file cycle: `src/config/index.ts -> src/infrastructure/secrets/workload-identity.ts -> src/infrastructure/secrets/secret-provider.ts -> src/config/index.ts`

## Communities (202 total, 80 thin omitted)

### Community 0 - "providers/index.ts"
Cohesion: 0.07
Nodes (28): CAPABILITY_DETAILS, COMPANY_DATA_CAPABILITIES, CompanyDataCapability, DataCapabilityDetail, ChProfile, ChSearchResult, ChStreamEvent, isHttpUrl() (+20 more)

### Community 1 - "malware-scan.worker.ts"
Cohesion: 0.08
Nodes (35): ApplicationCommandService, withEventLifecycle(), classifyFailure(), createMalwareScanner(), ApplicationTrackingJobPayloadSchema, ApplicationTrackingJobType, ApplicationTrackingJobTypeSchema, BaseJobPayload (+27 more)

### Community 2 - "normalization/index.ts"
Cohesion: 0.09
Nodes (28): canonicalNameKey(), normalizeCompanyName(), normalizeDisplayName(), titleCase(), CURRENCY_ALIASES, ISO_4217_CODES, isValidCurrencyCode(), normalizeCurrencyCode() (+20 more)

### Community 3 - "rule-based-classifier.ts"
Cohesion: 0.10
Nodes (30): COMPANY_FROM_TEXT_PATTERNS, companyFromDomain(), companyFromText(), extractCompany(), GENERIC_DOMAIN_LABELS, titleCase(), extractRole(), normalizeRole() (+22 more)

### Community 4 - "providers/registry.ts"
Cohesion: 0.09
Nodes (22): buildCompaniesHouseProviderConfig(), buildCompanyIntelConfig(), buildIndiaMcaProviderConfig(), buildSecProviderConfig(), CompaniesHouseProviderConfig, CompanyIntelConfig, CompanyIntelSettings, IndiaMcaProviderConfig (+14 more)

### Community 5 - "lifecycle-manager.ts"
Cohesion: 0.10
Nodes (16): describeProviderError(), providerErrorMessage(), ProviderLifecycleManager, LIFECYCLE_STATES, ProviderDependency, ProviderInitializeOptions, ProviderLifecycleState, ProviderRuntimeState (+8 more)

### Community 6 - "prisma"
Cohesion: 0.08
Nodes (10): prisma, FactCorrectionService, CreateExtractionRunInput, ExtractionRunContext, FactQualityInput, FactQualityStatus, FactService, getFactQualityStatus() (+2 more)

### Community 7 - "candidate-intelligence/index.ts"
Cohesion: 0.19
Nodes (15): CandidateIntelligenceContext, CompleteExtractionRunInput, CreateExtractionRunInput, CreateProvenanceInput, ExtractedFactRecord, ExtractionContext, ExtractionRunNotFoundError, ExtractionSourceType (+7 more)

### Community 8 - "rate-limiter.ts"
Cohesion: 0.09
Nodes (29): AuthenticatedUser, express, Request, requireAuth(), UnauthorizedError, authFloodLimiter, buildLimiterPair(), createRateLimiter() (+21 more)

### Community 9 - "UserService"
Cohesion: 0.10
Nodes (20): backfillForeignKeys(), backfillUsers(), BATCH_SIZE, collectDistinctLegacyUserIds(), DRY_RUN, LEGACY_COLUMNS, LegacyIdRow, main() (+12 more)

### Community 10 - "outcome.service.ts"
Cohesion: 0.10
Nodes (9): AnalyticsService, OUTCOME_CATEGORIES, OUTCOME_STATUS, OUTCOME_TYPE_TO_CATEGORY, OUTCOME_TYPE_TO_STATUS, OUTCOME_TYPES, OutcomeService, RecordOutcomeInput (+1 more)

### Community 11 - "CompanyProvider"
Cohesion: 0.14
Nodes (17): CompanyImporter, CompanyImporterDeps, createCompanyImporter(), RunContext, buildImportPlan(), BuildPlanResult, PlannerContext, PlanReason (+9 more)

### Community 12 - "prisma-company-intel.repository.ts"
Cohesion: 0.13
Nodes (16): ImportRunStatus, AuditLogInput, CompleteImportRunInput, CreateImportRunInput, ImportRunRecord, PersistCompanyResult, ProviderMetadataInput, ProviderRecordInput (+8 more)

### Community 13 - "dashboard.service.ts"
Cohesion: 0.09
Nodes (14): CacheEntry, CacheStore, InMemoryCacheStore, DEFAULT_ACTIVITY_LIMIT, DEFAULT_COLLECTION_LIMIT, DEFAULT_INITIAL_SYNC_BATCH_SIZE, DEFAULT_UPCOMING_LIMIT, MAX_INITIAL_SYNC_BATCH_SIZE (+6 more)

### Community 14 - "AppError"
Cohesion: 0.10
Nodes (20): RFC-1918, AppError, MissingPartitionKeyError, ValidationError, ConflictError, DomainValidationError, ForbiddenError, BLOCKED_HOSTNAMES (+12 more)

### Community 15 - "job-intelligence/index.ts"
Cohesion: 0.15
Nodes (15): ApplicationMergeService, MergeDecision, ExtractedJobData, JobApplicationCompany, JobApplicationDetails, JobApplicationHiringProcess, JobApplicationRecruiter, JobApplicationRole (+7 more)

### Community 16 - "src/index.ts"
Cohesion: 0.10
Nodes (23): app, gracefulShutdown(), httpTerminator, initObservability(), isAppReady, isShuttingDown, server, startupTime (+15 more)

### Community 17 - "event.types.ts"
Cohesion: 0.08
Nodes (25): DispatchedEvent, eventDispatcher, EventDispatcherService, NOTE: This convenience method writes the event in its own transaction., ACTION_EVENTS, ActionEventType, AGGREGATE_TYPES, AggregateType (+17 more)

### Community 18 - "app-errors.ts"
Cohesion: 0.11
Nodes (11): EncryptionError, GmailApiError, NotFoundError, OAuthError, TokenError, cryptoService, EncryptResult, OAuthStateService (+3 more)

### Community 19 - "S3StorageService"
Cohesion: 0.08
Nodes (6): CircuitBreaker, CircuitBreakerError, CircuitBreakerOptions, CircuitState, NullStorageService, S3StorageService

### Community 20 - "opportunity.service.ts"
Cohesion: 0.11
Nodes (19): backfillOpportunities(), BATCH_SIZE, DRY_RUN, main(), CanonicalOpportunity, OpportunityObservationInput, OpportunityObservationRecord, OpportunityResolutionInput (+11 more)

### Community 21 - "health.service.ts"
Cohesion: 0.16
Nodes (10): PostgresChecker, RedisChecker, StorageChecker, HealthService, HealthCheckResult, HealthReport, HealthStatus, IHealthChecker (+2 more)

### Community 22 - "recruiter.service.ts"
Cohesion: 0.12
Nodes (16): CompanyRecord, DbClient, LinkedEmailConversation, RecruiterBaseRecord, RecruiterInsight, RecruiterInsightQueryRecord, RecruiterListFilters, RecruiterListItem (+8 more)

### Community 23 - "NormalizedCompanyData"
Cohesion: 0.19
Nodes (15): RFC-3339, NormalizedCompanyData, DATE_RE, DATE_TIME_RE, isFutureTimestamp(), isValidTemporalRange(), isValidTimestamp(), normalizeTimestamp() (+7 more)

### Community 24 - "application-query.service.ts"
Cohesion: 0.14
Nodes (17): ApplicationCompanyModel, ApplicationDetailsModel, ApplicationDetailsView, ApplicationEmailHistoryItem, ApplicationHiringProcessModel, ApplicationRecruiterModel, ApplicationRoleModel, ApplicationSourceModel (+9 more)

### Community 25 - "logger.ts"
Cohesion: 0.09
Nodes (19): CircuitBreakerOptions, CircuitState, defaultOptions, calculateDelay(), defaultRetryOptions, RetryOptions, withRetry(), getLevel() (+11 more)

### Community 26 - "classification.test.ts"
Cohesion: 0.13
Nodes (15): BuiltInClassificationSystem, ISIC_SYSTEM, NACE_SYSTEM, NAICS_SYSTEM, SIC_SYSTEM, ClassificationImporter, ImporterConfig, ImporterFactory (+7 more)

### Community 27 - "ownership.guard.ts"
Cohesion: 0.14
Nodes (8): CellBoundaryViolationError, CrossUserOwnershipError, ExtractionRunStatus, ImmutabilityViolationError, DbClient, DbClient, CellRoutingService, RoutingDecision

### Community 28 - "application-tracking.service.ts"
Cohesion: 0.10
Nodes (13): PaginationInput, ApplicationStatusUpdateResult, ApplicationDetailsResult, ApplicationEmailRecord, ApplicationListFilters, ApplicationStatusHistoryEvent, ApplicationStatusUpdateResult, ApplicationTimelineEvent (+5 more)

### Community 29 - "encryption.ts"
Cohesion: 0.14
Nodes (21): SoftwareCryptoService, processReEncryptionJob(), ReEncryptionJobSchema, startReEncryptionWorker(), buildEnvVarName(), decryptToken(), encryptToken(), getActiveEncryptionVersion() (+13 more)

### Community 30 - "database.ts"
Cohesion: 0.10
Nodes (13): createPrismaClient(), databaseUrlForRole(), dbRouter, enrichUrl(), g, prismaReplica, attachRlsMiddleware(), TaxonomyKind (+5 more)

### Community 31 - "gmail-ingestion.service.ts"
Cohesion: 0.16
Nodes (16): features, RawEmailFetcher, EmailNormalizer, NormalizedEmailInput, EmailRecipients, GmailAttachment, GmailClientConfig, GmailLabel (+8 more)

### Community 32 - "InMemoryStateBackend"
Cohesion: 0.12
Nodes (4): InMemoryStateBackend, IOAuthStateBackend, RedisStateBackend, OAuthStateEntry

### Community 33 - "QueueService"
Cohesion: 0.12
Nodes (8): IQueueService, QueueService, ApplicationTrackingJobPayload, EmailJobPayload, GmailSyncJobPayload, IntelligenceJobPayload, MalwareScanJobPayload, ResumeParsingJobPayload

### Community 34 - "gmail-client.ts"
Cohesion: 0.14
Nodes (20): RFC-2822, GMAIL_CLIENT_DEFAULT_TIMEOUT_MS, GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS, GMAIL_CLIENT_MAX_RETRIES, GMAIL_HISTORY_MAX_RESULTS, GMAIL_INITIAL_SYNC_MESSAGE_CAP, GMAIL_LIST_MESSAGES_MAX_RESULTS, RETRYABLE_STATUS_CODES (+12 more)

### Community 35 - "action.service.ts"
Cohesion: 0.14
Nodes (11): ACTION_SUBTYPES, ACTION_TYPES, ActionService, buildResumeVersionTag(), GetUserActionsFilters, KNOWN_ACTION_TYPES, KNOWN_SOURCE_TYPES, RecordActionInput (+3 more)

### Community 36 - "CompanyProviderRegistry"
Cohesion: 0.11
Nodes (5): CompanyProviderRegistry, buildImporter(), disabledProvider(), fakeProvider(), silentLogger

### Community 38 - "scanner.factory.ts"
Cohesion: 0.18
Nodes (6): ClamAVScanner, MalwareScanner, ScanWithRetryOptions, NoOpScanner, IMalwareScanner, ScanResult

### Community 39 - "scripts"
Cohesion: 0.09
Nodes (23): scripts, audit, build, ci:validate-k8s-images, db:generate, db:migrate, db:migrate:deploy, db:push (+15 more)

### Community 40 - "compilerOptions"
Cohesion: 0.09
Nodes (23): ES2022, compilerOptions, baseUrl, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames (+15 more)

### Community 41 - "src/config/index.ts"
Cohesion: 0.13
Nodes (18): AppConfig, config, loadConfig(), validateProductionDatabaseCredentials(), validateProductionStorage(), validateSecrets(), validateSecurityConfig(), bullMQConnection (+10 more)

### Community 42 - "epic-0.7-privacy.test.ts"
Cohesion: 0.12
Nodes (24): createCryptoService(), getCriticalFields(), getDeletionScopeFields(), getEncryptedFields(), getLogRedactionFields(), LegalBasis, PII_INVENTORY, PIIField (+16 more)

### Community 43 - "placement.service.ts"
Cohesion: 0.16
Nodes (16): CellRecord, CellResolution, DbClient, InProcessEntry, regionFromAcceptLanguage(), regionFromCfCountry(), RegionResolutionHints, resolveRegionFromHints() (+8 more)

### Community 44 - "resume-versioning.service.test.ts"
Cohesion: 0.12
Nodes (8): DbClient, DataRetentionService, daysAgo(), storageService, UploadResult, MockPrisma, MockStorage, SAMPLE_PDF_BUFFER

### Community 46 - "ApplicationStatus"
Cohesion: 0.20
Nodes (8): ApplicationStatus, ApplicationStatusHistoryRecord, ApplicationStatusSource, DbClient, StatusChangeInput, StatusChangeResult, StatusEngine, StatusHistoryItem

### Community 47 - "authenticity/engine.ts"
Cohesion: 0.18
Nodes (9): AuthenticityEngine, AuthenticityRuleExecutor, AuthenticityEvidence, AuthenticityRiskIndicator, CompanyAuthenticityResult, AuthenticityRuleDefinition, AuthenticityRuleRegistry, BUILT_IN_AUTHENTICITY_RULES (+1 more)

### Community 48 - "identifier-types.ts"
Cohesion: 0.22
Nodes (16): alphanumeric(), cikInputLooksNumeric(), digits(), IDENTIFIER_TYPES, IDENTIFIER_TYPES_SET, IdentifierNormalizationResult, IdentifierType, isKnownIdentifierType() (+8 more)

### Community 49 - "health/engine.ts"
Cohesion: 0.17
Nodes (9): HealthScoringEngine, IndicatorCalculator, CompanyHealthProfile, HealthEvidence, HealthIndicatorResult, BUILT_IN_HEALTH_INDICATORS, HealthIndicatorDefinition, HealthIndicatorRegistry (+1 more)

### Community 50 - "secret-provider.ts"
Cohesion: 0.11
Nodes (7): CloudSecretProvider, createSecretProvider(), EnvironmentSecretProvider, getSecretProvider(), ISecretProvider, SecretName, VaultSecretProvider

### Community 51 - "applications.routes.ts"
Cohesion: 0.18
Nodes (16): writeLimiter, applyStrict(), formatZodError(), validateBody(), validateParams(), validateQuery(), applicationsRouter, listQuerySchema (+8 more)

### Community 52 - "CompanyIntelligenceApiService"
Cohesion: 0.15
Nodes (5): apiService, companyIntelligenceRouter, app, ApiResponse, CompanyIntelligenceApiService

### Community 53 - "queue.service.ts"
Cohesion: 0.23
Nodes (17): IDEMPOTENCY_PREFIXES, IdempotencyOperation, isWellFormedKey(), jobIdForApplicationMerge(), jobIdForEmailIngestion(), jobIdForResumeOperation(), keyForAppFromEmail(), keyForAppFromManual() (+9 more)

### Community 54 - "idempotency.service.ts"
Cohesion: 0.17
Nodes (9): createApplicationSnapshot(), recordApplicationSentOutcome(), ClaimResult, computeExpiresAt(), DbClient, DEFAULT_IDEMPOTENCY_TTL_DAYS, IdempotencyResult, IdempotencyService (+1 more)

### Community 55 - "ProviderHealthTracker"
Cohesion: 0.17
Nodes (7): HealthTrackerOptions, ProviderHealthSnapshot, ProviderHealthTracker, RecordFailureOptions, RecordSuccessOptions, LifecycleManagerDeps, ProviderHealthStatus

### Community 57 - "market-identity/engine.ts"
Cohesion: 0.19
Nodes (8): MarketIdentityEngine, CorporateAction, ListingHistory, MarketIdentifier, MarketMetadata, BUILT_IN_IDENTIFIERS, IdentifierRegistry, IdentifierTypeDefinition

### Community 58 - "RelationshipEngine"
Cohesion: 0.19
Nodes (6): RelationshipEngine, EntityRelationship, RelationshipMetadata, BUILT_IN_RELATIONSHIPS, RelationshipRegistry, RelationshipTypeDefinition

### Community 59 - "SnapshotService"
Cohesion: 0.13
Nodes (7): CandidateStateV1, CanonicalFactSnapshot, CaptureIntelligenceSnapshotInput, SnapshotService, TemporalSnapshot, makeSnap(), makeStateV1()

### Community 60 - "devDependencies"
Cohesion: 0.11
Nodes (19): eslint, jest, devDependencies, eslint, jest, pg, prettier, prisma (+11 more)

### Community 61 - "import-ontology.ts"
Cohesion: 0.24
Nodes (17): DATA_DIR, globalStats, ImportStats, loadCountriesAndZones(), loadCurrencies(), loadEsco(), loadIsco(), loadOnet() (+9 more)

### Community 62 - "base.repository.ts"
Cohesion: 0.15
Nodes (7): ApplicationRepository, BaseRepository, EmailMessageRepository, FindManyOptions, ModelName, SyncJobRepository, WhereClause

### Community 64 - "entity-resolution.ts"
Cohesion: 0.20
Nodes (7): CandidateMatch, CompanyEntityResolver, createCompanyEntityResolver(), DEFAULT_ENTITY_RESOLUTION_CONFIG, EntityResolutionConfig, EntityResolutionConflictError, ResolverRepository

### Community 65 - "geographic/engine.ts"
Cohesion: 0.19
Nodes (8): GeographicEngine, AdministrativeHierarchy, Coordinates, GeographicLocation, GeographicMetadata, BUILT_IN_LOCATION_TYPES, LocationTypeDefinition, LocationTypeRegistry

### Community 67 - "rls.ts"
Cohesion: 0.12
Nodes (9): @prisma/client, @prisma/client, OperationRole, RequestContext, requestContextStore, RLS_ROLES, setRlsUserIdInTransaction(), withPrivilegedTransaction() (+1 more)

### Community 68 - "application-timeline.service.ts"
Cohesion: 0.16
Nodes (13): clampNonNegativeInteger(), clampPositiveInteger(), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PaginationWindow, resolvePagination(), ApplicationTimelineRecord, CreateTimelineEventInput (+5 more)

### Community 69 - "resume-upload.service.ts"
Cohesion: 0.13
Nodes (15): parseSizeToBytes(), SIZE_UNITS, ActiveResumeRow, ApplicationResumeLinkContext, FILE_SIGNATURES, MAX_FILE_SIZE_BYTES, ResumeUploadInput, ResumeUploadResult (+7 more)

### Community 70 - "contracts/index.ts"
Cohesion: 0.20
Nodes (13): CompanyRawData, CompanyStatus, ProviderRecordMetadata, RawAddressInput, RawExchangeListingInput, RawIdentifierInput, RawIndustryClassificationInput, RawWebsiteInput (+5 more)

### Community 71 - "timeline/engine.ts"
Cohesion: 0.23
Nodes (6): TimelineEngine, TimelineEvent, TimelineSnapshot, BUILT_IN_EVENTS, EventRegistry, EventTypeDefinition

### Community 72 - "resume-matcher.service.ts"
Cohesion: 0.19
Nodes (9): getJobOccupationLexicon(), getJobSkillLexicon(), getResumeOccupationLexicon(), getResumeSkillLexicon(), MatchScore, ParsedJob, ParsedResume, EDUCATION_PATTERNS (+1 more)

### Community 73 - "enrichment/engine.ts"
Cohesion: 0.23
Nodes (5): EnrichmentEngine, EnrichmentRecord, BUILT_IN_ENRICHMENT_CATEGORIES, EnrichmentProviderDefinition, EnrichmentProviderRegistry

### Community 74 - "rules"
Cohesion: 0.12
Nodes (16): rules, no-console, no-var, prefer-const, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument (+8 more)

### Community 75 - "redis.ts"
Cohesion: 0.17
Nodes (12): buildRedisConfig(), bullMQConnection, BullMQConnectionOptions, createBullMQConnection(), createRedisClient(), RedisConfig, EmailJobPayloadSchema, processEmailJob() (+4 more)

### Community 76 - "canonical-role.ts"
Cohesion: 0.23
Nodes (8): CanonicalRoleInput, CanonicalRoleRecord, ROLE_CATEGORIES, ROLE_SENIORITY, RoleCategory, RoleSeniority, CanonicalRoleService, DbClient

### Community 77 - "recommendation.service.ts"
Cohesion: 0.23
Nodes (8): RECOMMENDATION_TARGET_TYPES, RECOMMENDATION_TYPES, RecommendationInput, RecommendationRecord, RecommendationTargetType, RecommendationType, DbClient, RecommendationService

### Community 78 - "metrics.ts"
Cohesion: 0.15
Nodes (14): express-serve-static-core, REDACTED_REQUEST_HEADERS, Request, requestLogger(), sanitizePathForLog(), databaseQueryDuration, eventLoopLagGauge, getMetrics() (+6 more)

### Community 80 - "errors.ts"
Cohesion: 0.18
Nodes (11): ProviderAuthenticationError, ProviderConfigurationError, ProviderError, ProviderErrorCode, ProviderErrorContext, ProviderErrorOptions, ProviderMalformedResponseError, ProviderNetworkError (+3 more)

### Community 81 - "country.ts"
Cohesion: 0.25
Nodes (14): ALPHA2_TO_ENTRY, ALPHA3_TO_ENTRY, COUNTRY_ALIASES, countryCodeToAlpha3(), CountryEntry, isCountryAlpha2(), isCountryAlpha3(), ISO_COUNTRIES (+6 more)

### Community 83 - "email-parser.service.ts"
Cohesion: 0.23
Nodes (8): GmailMessagePart, GmailMessagePartHeader, AttachmentMetadata, NormalizedEmail, EmailParserService, GmailMessage, GmailMessageHeader, GmailMessagePart

### Community 84 - "hiring/engine.ts"
Cohesion: 0.25
Nodes (6): HiringAggregationEngine, HiringSignal, HiringSignalEvidence, BUILT_IN_HIRING_SIGNALS, HiringSignalDefinition, HiringSignalRegistry

### Community 86 - "placement.ts"
Cohesion: 0.20
Nodes (6): anonymousPlacement(), express, placementMiddleware(), Request, DataPlaneClient, SupportedRegion

### Community 87 - "resume.routes.ts"
Cohesion: 0.14
Nodes (12): expensiveLimiter, uploadLimiter, listQuerySchema, paramIdSchema, recruitersRouter, ALLOWED_RESUME_MIME_TYPES, MAX_MULTIPART_SIZE_BYTES, resumeRouter (+4 more)

### Community 88 - "companies.routes.ts"
Cohesion: 0.15
Nodes (11): generalApiLimiter, companiesRouter, companyApplicationsQuerySchema, listQuerySchema, paramIdSchema, dashboardRouter, pagingSchema, app (+3 more)

### Community 89 - "outbox-dispatcher.service.ts"
Cohesion: 0.20
Nodes (4): clearWorkerRlsContext(), setWorkerRlsContext(), OutboxDispatcher, OutboxOptions

### Community 91 - "googleapis-shim.ts"
Cohesion: 0.14
Nodes (13): APIRequestContext, Auth, BodyResponseCallback, calendar, drive, GaxiosPromise, GlobalOptions, gmail (+5 more)

### Community 92 - "career-preferences.ts"
Cohesion: 0.22
Nodes (13): Availability, CareerPreferences, CareerStage, coerceAvailability(), coerceCareerPreferences(), coerceCompensation(), coerceVisaWorkRequirements(), CompensationExpectation (+5 more)

### Community 93 - "middleware.ts"
Cohesion: 0.21
Nodes (11): checkStructureLimits(), httpMethodProtection(), parameterPollutionProtection(), requestLimits(), requestTimeout(), securityHeaders(), isSafeKey(), isValidOrigin() (+3 more)

### Community 94 - "IStorageService"
Cohesion: 0.16
Nodes (3): sanitizeFilename(), ALLOWED_MIME_TYPES, IStorageService

### Community 96 - "PlacementService"
Cohesion: 0.33
Nodes (3): computeShardKey(), PlacementService, PlacementContext

### Community 97 - "company.service.ts"
Cohesion: 0.21
Nodes (11): CANONICAL_ALIAS_OVERRIDES, CompanyApplicationListItem, CompanyDetails, CompanyListFilters, CompanyListItem, CompanyRecord, CompanyResolveInput, CompanyWithRelations (+3 more)

### Community 98 - "company-signal.service.ts"
Cohesion: 0.31
Nodes (6): COMPANY_SIGNAL_TYPES, CompanySignalInput, CompanySignalRecord, CompanySignalType, CompanySignalService, DbClient

### Community 100 - "userOwnershipFilter"
Cohesion: 0.31
Nodes (3): withRlsTransaction(), ResumeUploadService, userOwnershipFilter()

### Community 102 - ".eslintrc.json"
Cohesion: 0.17
Nodes (11): env, jest, node, extends, parser, plugins, root, eslint:recommended (+3 more)

### Community 103 - "application-command.service.ts"
Cohesion: 0.20
Nodes (8): executeWithTransientRetry(), TransactionRetryOptions, ApplicationSourceInput, ApplicationSourceMetadata, ApplicationSourceProvider, ApplicationTimelineEvent, DbClient, JobApplicationRecord

### Community 109 - "ignorePatterns"
Cohesion: 0.18
Nodes (10): ignorePatterns, dist/, node_modules/, *.js, src/**/*, src/**/*.d.ts, src/__tests__/**/*.ts, exclude (+2 more)

### Community 111 - "analytics.service.ts"
Cohesion: 0.22
Nodes (8): analyticsRouter, handle(), BenchmarkSummary, DbClient, FunnelSummary, PerformanceRow, RateInterval, app

### Community 112 - "storage/index.ts"
Cohesion: 0.42
Nodes (6): CompanyIntelStorageBackend, S3StorageOptions, StorageFactoryOptions, CompanyDataStorageKind, CompanyDataStorageOptions, StoredObject

### Community 114 - "GmailOAuthService"
Cohesion: 0.27
Nodes (3): GMAIL_SCOPES, GmailOAuthService, GoogleUserProfile

### Community 115 - "canonical-intelligence.service.ts"
Cohesion: 0.15
Nodes (11): CanonicalIntelligenceRecord, EnrichedCanonicalRecord, GetCanonicalIntelligenceQuery, MATERIALISATION_RULES, MaterialiseFactInput, MaterialiseResult, candidateWins(), CanonicalIntelligenceService (+3 more)

### Community 116 - "ai-data-protection.ts"
Cohesion: 0.50
Nodes (4): AI_DATA_PROTECTION_POLICY, assertAiDataMinimisation(), CREDENTIAL_PATTERNS, serializeForPatternCheck()

### Community 117 - "opportunity.service.test.ts"
Cohesion: 0.33
Nodes (7): acquireLock(), getRedis(), releaseLock(), COMPANY_1, INPUT, MockPrisma, OPPORTUNITY_EXISTING

### Community 119 - "gmail-ingestion-coordinator.ts"
Cohesion: 0.33
Nodes (8): emitTelemetry(), enqueueGmailIngestion(), isBackpressured(), validateUserOwnsConnection(), FailureClassification, GmailIngestionCommand, GmailIngestionState, GmailIngestionTelemetry

### Community 120 - "backfill-application-resumes.ts"
Cohesion: 0.28
Nodes (8): ApplicationRow, backfillApplicationResumes(), BackfillSummary, BATCH_SIZE, DRY_RUN, main(), pickResumeForApplication(), ResumeRow

### Community 121 - "validate-k8s-images.js"
Cohesion: 0.22
Nodes (8): args, failures, fs, HARD_MUTABLE_TAGS, k8sDir, path, warnings, warnOnly

### Community 124 - "backfill-placement.ts"
Cohesion: 0.32
Nodes (7): backfillPlacement(), BATCH_SIZE, CandidateRow, DRY_RUN, main(), Summary, normalizeRegion()

### Community 125 - "internal-api.ts"
Cohesion: 0.36
Nodes (5): ForbiddenInternalError, requireInternalApiKey(), timingSafeBufferEqual(), timingSafeStringEqual(), verifyHmacSha256()

### Community 128 - "embedding.service.ts"
Cohesion: 0.29
Nodes (4): EmbeddingInput, EmbeddingRecord, EmbeddingService, EmbeddingVector

### Community 129 - "dependencies"
Cohesion: 0.38
Nodes (7): @opentelemetry/api, @opentelemetry/instrumentation-pg, dependencies, @opentelemetry/api, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-ioredis, @opentelemetry/instrumentation-pg

### Community 130 - "package.json"
Cohesion: 0.29
Nodes (6): description, engines, node, main, name, private

### Community 134 - "resume-parser.service.ts"
Cohesion: 0.29
Nodes (4): IResumeParser, ObservationCategory, ParseResult, ResumeObservation

### Community 137 - "googleapis-recommender-shim.d.ts"
Cohesion: 0.33
Nodes (4): googleapis/build/src/apis/recommender/v1beta1, Options, Recommender, recommender_v1beta1

### Community 138 - "embeddings.ts"
Cohesion: 0.60
Nodes (3): jaccardScore(), tokenize(), TokenOverlapMatcher

### Community 140 - "parserOptions"
Cohesion: 0.50
Nodes (4): parserOptions, ecmaVersion, project, sourceType

### Community 141 - "substitute-k8s-digests.sh"
Cohesion: 1.00
Nodes (3): pin_manifest(), substitute-k8s-digests.sh script, substitute_digest()

### Community 144 - "types"
Cohesion: 0.67
Nodes (3): jest, node, types

### Community 145 - "typeRoots"
Cohesion: 0.67
Nodes (3): ./node_modules/@types, ./src/types, typeRoots

### Community 146 - "paths"
Cohesion: 0.67
Nodes (3): src/types/googleapis-shim.ts, paths, googleapis

### Community 201 - "canonical-intelligence.test.ts"
Cohesion: 0.18
Nodes (5): CanonicalIntelligenceNotFoundError, FactNotEligibleError, MaterialisationOwnershipError, makeCanonical(), makeProvenance()

## Knowledge Gaps
- **559 isolated node(s):** `root`, `parser`, `ecmaVersion`, `sourceType`, `project` (+554 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **80 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Logger` connect `logger.ts` to `malware-scan.worker.ts`, `lifecycle-manager.ts`, `prisma`, `candidate-intelligence/index.ts`, `rate-limiter.ts`, `UserService`, `outcome.service.ts`, `CompanyProvider`, `prisma-company-intel.repository.ts`, `AppError`, `src/index.ts`, `event.types.ts`, `app-errors.ts`, `opportunity.service.ts`, `application-tracking.service.ts`, `database.ts`, `gmail-ingestion.service.ts`, `action.service.ts`, `scanner.factory.ts`, `epic-0.7-privacy.test.ts`, `placement.service.ts`, `resume-versioning.service.test.ts`, `applications.routes.ts`, `queue.service.ts`, `idempotency.service.ts`, `ProviderHealthTracker`, `SnapshotService`, `base.repository.ts`, `rls.ts`, `resume-upload.service.ts`, `resume-matcher.service.ts`, `redis.ts`, `metrics.ts`, `placement.ts`, `outbox-dispatcher.service.ts`, `application-command.service.ts`, `DatabaseRouter`, `canonical-intelligence.service.ts`, `opportunity.service.test.ts`, `gmail-ingestion-coordinator.ts`, `backfill-application-resumes.ts`, `backfill-placement.ts`, `internal-api.ts`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`, `@aws-sdk/client-kms`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `blocked-at`, `bullmq`, `compression`, `cors`, `dotenv`, `express`, `googleapis`, `helmet`, `http-terminator`, `ioredis`, `jsonwebtoken`, `multer`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-express`, `@opentelemetry/resources`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/semantic-conventions`, `pdf-parse`, `prom-client`, `rate-limiter-flexible`, `@types/jsonwebtoken`, `uuid`, `zod`, `rls.ts`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `@prisma/client` connect `rls.ts` to `dependencies`, `userOwnershipFilter`, `database.ts`, `application-command.service.ts`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **What connects `root`, `parser`, `ecmaVersion` to the rest of the system?**
  _559 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `providers/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07017543859649122 - nodes in this community are weakly interconnected._
- **Should `malware-scan.worker.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08456659619450317 - nodes in this community are weakly interconnected._
- **Should `normalization/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09191583610188261 - nodes in this community are weakly interconnected._