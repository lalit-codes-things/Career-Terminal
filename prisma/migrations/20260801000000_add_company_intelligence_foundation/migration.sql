-- CreateEnum
CREATE TYPE "CompanyLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISSOLVED', 'DORMANT', 'LIQUIDATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CompanyImportType" AS ENUM ('FULL', 'INCREMENTAL', 'SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "CompanyImportRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "canonical_companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "normalized_name" TEXT NOT NULL,
    "domain" TEXT,
    "country_code" TEXT,
    "jurisdiction_code" TEXT,
    "status" "CompanyLifecycleStatus" NOT NULL DEFAULT 'UNKNOWN',
    "founded_date" DATE,
    "incorporated_date" DATE,
    "description" TEXT,
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "enrichment_status" TEXT NOT NULL DEFAULT 'none',
    "enrichment_version" INTEGER,
    "last_enriched_at" TIMESTAMPTZ,
    "company_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "canonical_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_company_aliases" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL DEFAULT 'trade',
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_company_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_identifiers" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "jurisdiction_code" TEXT,
    "registrar" TEXT,
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_websites" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'primary',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_addresses" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "address_type" TEXT NOT NULL DEFAULT 'registered',
    "address_lines" TEXT[],
    "locality" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country_code" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_industry_classifications" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "classification_system" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_industry_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_exchange_listings" (
    "id" UUID NOT NULL,
    "canonical_company_id" UUID NOT NULL,
    "exchange" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "currency" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "listing_status" TEXT NOT NULL DEFAULT 'listed',
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_exchange_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_providers" (
    "id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "jurisdiction" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "last_health_check_at" TIMESTAMPTZ,
    "last_run_at" TIMESTAMPTZ,
    "last_run_status" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_import_runs" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "import_type" "CompanyImportType" NOT NULL,
    "status" "CompanyImportRunStatus" NOT NULL,
    "since" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "records_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_validated" INTEGER NOT NULL DEFAULT 0,
    "records_failed_validation" INTEGER NOT NULL DEFAULT 0,
    "companies_created" INTEGER NOT NULL DEFAULT 0,
    "companies_updated" INTEGER NOT NULL DEFAULT 0,
    "companies_matched" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "correlation_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_provider_records" (
    "id" UUID NOT NULL,
    "import_run_id" UUID NOT NULL,
    "canonical_company_id" UUID,
    "provider_key" TEXT NOT NULL,
    "provider_record_id" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "checksum" TEXT NOT NULL,
    "raw_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_provider_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_audit_logs" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canonical_companies_company_id_key" ON "canonical_companies"("company_id");

-- CreateIndex
CREATE INDEX "canonical_companies_normalized_name_idx" ON "canonical_companies"("normalized_name");

-- CreateIndex
CREATE INDEX "canonical_companies_domain_idx" ON "canonical_companies"("domain");

-- CreateIndex
CREATE INDEX "canonical_companies_country_code_idx" ON "canonical_companies"("country_code");

-- CreateIndex
CREATE INDEX "canonical_companies_jurisdiction_code_idx" ON "canonical_companies"("jurisdiction_code");

-- CreateIndex
CREATE INDEX "canonical_companies_status_idx" ON "canonical_companies"("status");

-- CreateIndex
CREATE INDEX "canonical_companies_valid_from_valid_to_idx" ON "canonical_companies"("valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "canonical_company_aliases_normalized_value_idx" ON "canonical_company_aliases"("normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_company_aliases_canonical_company_id_normalized_v_key" ON "canonical_company_aliases"("canonical_company_id", "normalized_value");

-- CreateIndex
CREATE INDEX "company_identifiers_normalized_value_idx" ON "company_identifiers"("normalized_value");

-- CreateIndex
CREATE INDEX "company_identifiers_type_idx" ON "company_identifiers"("type");

-- CreateIndex
CREATE UNIQUE INDEX "company_identifiers_type_normalized_value_jurisdiction_code_key" ON "company_identifiers"("type", "normalized_value", "jurisdiction_code");

-- CreateIndex
CREATE INDEX "company_websites_normalized_url_idx" ON "company_websites"("normalized_url");

-- CreateIndex
CREATE UNIQUE INDEX "company_websites_canonical_company_id_normalized_url_key" ON "company_websites"("canonical_company_id", "normalized_url");

-- CreateIndex
CREATE INDEX "company_addresses_canonical_company_id_address_type_idx" ON "company_addresses"("canonical_company_id", "address_type");

-- CreateIndex
CREATE INDEX "company_addresses_country_code_idx" ON "company_addresses"("country_code");

-- CreateIndex
CREATE INDEX "company_industry_classifications_classification_system_code_idx" ON "company_industry_classifications"("classification_system", "code");

-- CreateIndex
CREATE UNIQUE INDEX "company_industry_classifications_canonical_company_id_class_key" ON "company_industry_classifications"("canonical_company_id", "classification_system", "code");

-- CreateIndex
CREATE INDEX "company_exchange_listings_exchange_ticker_idx" ON "company_exchange_listings"("exchange", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "company_exchange_listings_canonical_company_id_exchange_tic_key" ON "company_exchange_listings"("canonical_company_id", "exchange", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "company_providers_provider_key_key" ON "company_providers"("provider_key");

-- CreateIndex
CREATE INDEX "company_import_runs_provider_key_import_type_idx" ON "company_import_runs"("provider_key", "import_type");

-- CreateIndex
CREATE INDEX "company_import_runs_provider_id_started_at_idx" ON "company_import_runs"("provider_id", "started_at");

-- CreateIndex
CREATE INDEX "company_import_runs_status_idx" ON "company_import_runs"("status");

-- CreateIndex
CREATE INDEX "company_provider_records_canonical_company_id_idx" ON "company_provider_records"("canonical_company_id");

-- CreateIndex
CREATE INDEX "company_provider_records_import_run_id_idx" ON "company_provider_records"("import_run_id");

-- CreateIndex
CREATE INDEX "company_provider_records_fetched_at_idx" ON "company_provider_records"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_provider_records_provider_key_provider_record_id_key" ON "company_provider_records"("provider_key", "provider_record_id");

-- CreateIndex
CREATE INDEX "company_audit_logs_entity_type_entity_id_idx" ON "company_audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "company_audit_logs_entity_id_created_at_idx" ON "company_audit_logs"("entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "canonical_companies" ADD CONSTRAINT "canonical_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_company_aliases" ADD CONSTRAINT "canonical_company_aliases_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_identifiers" ADD CONSTRAINT "company_identifiers_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_websites" ADD CONSTRAINT "company_websites_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_addresses" ADD CONSTRAINT "company_addresses_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_industry_classifications" ADD CONSTRAINT "company_industry_classifications_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_exchange_listings" ADD CONSTRAINT "company_exchange_listings_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_import_runs" ADD CONSTRAINT "company_import_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "company_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_provider_records" ADD CONSTRAINT "company_provider_records_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "company_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_provider_records" ADD CONSTRAINT "company_provider_records_canonical_company_id_fkey" FOREIGN KEY ("canonical_company_id") REFERENCES "canonical_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

