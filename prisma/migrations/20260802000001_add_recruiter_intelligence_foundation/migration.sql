-- CreateEnum
CREATE TYPE "RecruiterVerificationStatus" AS ENUM ('VERIFIED', 'PENDING', 'UNVERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RecruiterEventType" AS ENUM ('RECRUITER_CREATED', 'RECRUITER_UPDATED', 'RECRUITER_MERGED', 'EMPLOYMENT_ADDED', 'EMPLOYMENT_UPDATED', 'COMMUNICATION_IMPORTED', 'FACT_RECORDED', 'FACT_UPDATED', 'FACT_SUPERSEDED', 'EVIDENCE_ATTACHED');

-- CreateTable
CREATE TABLE "recruiter_identities" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "canonical_recruiter_id" UUID,
    "identity_type" TEXT NOT NULL,
    "identity_value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_aliases" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_emails" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_phones" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "normalized_phone" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_social_profiles" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "profile_type" TEXT NOT NULL,
    "profile_value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_social_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_employments" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "organization_id" UUID,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "team" TEXT,
    "start_date" TIMESTAMPTZ,
    "end_date" TIMESTAMPTZ,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_employments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_roles" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "role_name" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_departments" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "department_name" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_teams" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "team_name" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_organizations" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "organization_name" TEXT NOT NULL,
    "domain" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_offices" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "office_name" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_locations" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "location_name" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_languages" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "language_code" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_timezones" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_timezones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_events" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "event_type" "RecruiterEventType" NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "correlation_id" TEXT,
    "causation_id" TEXT,
    "payload" JSONB NOT NULL,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_facts" (
    "id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "fact_type" TEXT NOT NULL,
    "fact_value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "verification_status" "RecruiterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_to" TIMESTAMPTZ,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ,
    "source" TEXT NOT NULL,
    "provenance_json" JSONB NOT NULL,
    "evidence_json" JSONB NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recruiter_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_identity_unique" ON "recruiter_identities"("identity_type", "normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_alias_unique" ON "recruiter_aliases"("recruiter_id", "normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_email_unique" ON "recruiter_emails"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_phone_unique" ON "recruiter_phones"("normalized_phone");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_social_profile_unique" ON "recruiter_social_profiles"("profile_type", "normalized_value");

-- CreateIndex
CREATE INDEX "recruiter_identities_recruiter_id_idx" ON "recruiter_identities"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_identities_canonical_recruiter_id_idx" ON "recruiter_identities"("canonical_recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_identities_identity_type_normalized_value_idx" ON "recruiter_identities"("identity_type", "normalized_value");

-- CreateIndex
CREATE INDEX "recruiter_identities_verification_status_idx" ON "recruiter_identities"("verification_status");

-- CreateIndex
CREATE INDEX "recruiter_identities_deleted_at_idx" ON "recruiter_identities"("deleted_at");

-- CreateIndex
CREATE INDEX "recruiter_aliases_recruiter_id_idx" ON "recruiter_aliases"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_aliases_normalized_alias_idx" ON "recruiter_aliases"("normalized_alias");

-- CreateIndex
CREATE INDEX "recruiter_aliases_verification_status_idx" ON "recruiter_aliases"("verification_status");

-- CreateIndex
CREATE INDEX "recruiter_aliases_deleted_at_idx" ON "recruiter_aliases"("deleted_at");

-- CreateIndex
CREATE INDEX "recruiter_emails_recruiter_id_idx" ON "recruiter_emails"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_emails_normalized_email_idx" ON "recruiter_emails"("normalized_email");

-- CreateIndex
CREATE INDEX "recruiter_emails_verification_status_idx" ON "recruiter_emails"("verification_status");

-- CreateIndex
CREATE INDEX "recruiter_phones_recruiter_id_idx" ON "recruiter_phones"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_phones_normalized_phone_idx" ON "recruiter_phones"("normalized_phone");

-- CreateIndex
CREATE INDEX "recruiter_social_profiles_recruiter_id_idx" ON "recruiter_social_profiles"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_social_profiles_profile_type_normalized_value_idx" ON "recruiter_social_profiles"("profile_type", "normalized_value");

-- CreateIndex
CREATE INDEX "recruiter_employments_recruiter_id_idx" ON "recruiter_employments"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_employments_organization_id_idx" ON "recruiter_employments"("organization_id");

-- CreateIndex
CREATE INDEX "recruiter_employments_department_idx" ON "recruiter_employments"("department");

-- CreateIndex
CREATE INDEX "recruiter_employments_team_idx" ON "recruiter_employments"("team");

-- CreateIndex
CREATE INDEX "recruiter_employments_deleted_at_idx" ON "recruiter_employments"("deleted_at");

-- CreateIndex
CREATE INDEX "recruiter_roles_recruiter_id_idx" ON "recruiter_roles"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_roles_role_name_idx" ON "recruiter_roles"("role_name");

-- CreateIndex
CREATE INDEX "recruiter_departments_recruiter_id_idx" ON "recruiter_departments"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_departments_department_name_idx" ON "recruiter_departments"("department_name");

-- CreateIndex
CREATE INDEX "recruiter_teams_recruiter_id_idx" ON "recruiter_teams"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_teams_team_name_idx" ON "recruiter_teams"("team_name");

-- CreateIndex
CREATE INDEX "recruiter_organizations_recruiter_id_idx" ON "recruiter_organizations"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_organizations_organization_name_idx" ON "recruiter_organizations"("organization_name");

-- CreateIndex
CREATE INDEX "recruiter_organizations_domain_idx" ON "recruiter_organizations"("domain");

-- CreateIndex
CREATE INDEX "recruiter_offices_recruiter_id_idx" ON "recruiter_offices"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_offices_office_name_idx" ON "recruiter_offices"("office_name");

-- CreateIndex
CREATE INDEX "recruiter_locations_recruiter_id_idx" ON "recruiter_locations"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_locations_location_name_idx" ON "recruiter_locations"("location_name");

-- CreateIndex
CREATE INDEX "recruiter_languages_recruiter_id_idx" ON "recruiter_languages"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_languages_language_code_idx" ON "recruiter_languages"("language_code");

-- CreateIndex
CREATE INDEX "recruiter_timezones_recruiter_id_idx" ON "recruiter_timezones"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_timezones_timezone_idx" ON "recruiter_timezones"("timezone");

-- CreateIndex
CREATE INDEX "recruiter_events_recruiter_id_idx" ON "recruiter_events"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_events_event_type_idx" ON "recruiter_events"("event_type");

-- CreateIndex
CREATE INDEX "recruiter_events_correlation_id_idx" ON "recruiter_events"("correlation_id");

-- CreateIndex
CREATE INDEX "recruiter_events_recorded_at_idx" ON "recruiter_events"("recorded_at");

-- CreateIndex
CREATE INDEX "recruiter_facts_recruiter_id_idx" ON "recruiter_facts"("recruiter_id");

-- CreateIndex
CREATE INDEX "recruiter_facts_fact_type_idx" ON "recruiter_facts"("fact_type");

-- CreateIndex
CREATE INDEX "recruiter_facts_valid_from_valid_to_idx" ON "recruiter_facts"("valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "recruiter_facts_verification_status_idx" ON "recruiter_facts"("verification_status");

-- CreateIndex
CREATE INDEX "recruiter_facts_deleted_at_idx" ON "recruiter_facts"("deleted_at");
