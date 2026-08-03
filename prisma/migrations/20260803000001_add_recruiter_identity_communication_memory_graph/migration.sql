CREATE TABLE "recruiter_conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recruiter_id" UUID,
  "user_id" UUID,
  "provider" TEXT NOT NULL,
  "provider_thread_id" TEXT NOT NULL,
  "first_contact_at" TIMESTAMPTZ NOT NULL,
  "latest_contact_at" TIMESTAMPTZ NOT NULL,
  "response_latency_ms" INTEGER,
  "follow_up_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "evidence_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "recruiter_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recruiter_conversation_provider_thread_unique" ON "recruiter_conversations"("provider", "provider_thread_id");
CREATE INDEX "recruiter_conversations_recruiter_id_idx" ON "recruiter_conversations"("recruiter_id");
CREATE INDEX "recruiter_conversations_user_id_idx" ON "recruiter_conversations"("user_id");
CREATE INDEX "recruiter_conversations_latest_contact_at_idx" ON "recruiter_conversations"("latest_contact_at");

CREATE TABLE "recruiter_communication_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "recruiter_id" UUID,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "subject" TEXT,
  "snippet" TEXT,
  "sent_at" TIMESTAMPTZ NOT NULL,
  "participants_json" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "evidence_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recruiter_communication_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recruiter_message_provider_message_unique" ON "recruiter_communication_messages"("provider", "provider_message_id");
CREATE INDEX "recruiter_communication_messages_conversation_id_idx" ON "recruiter_communication_messages"("conversation_id");
CREATE INDEX "recruiter_communication_messages_recruiter_id_idx" ON "recruiter_communication_messages"("recruiter_id");
CREATE INDEX "recruiter_communication_messages_sent_at_idx" ON "recruiter_communication_messages"("sent_at");

CREATE TABLE "recruiter_resolution_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_recruiter_id" UUID,
  "candidate_recruiter_id" UUID,
  "decision_type" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "requires_human_review" BOOLEAN NOT NULL DEFAULT false,
  "explanation" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL DEFAULT '[]',
  "provenance_json" JSONB NOT NULL DEFAULT '{}',
  "reviewed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recruiter_resolution_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recruiter_resolution_decisions_source_recruiter_id_idx" ON "recruiter_resolution_decisions"("source_recruiter_id");
CREATE INDEX "recruiter_resolution_decisions_candidate_recruiter_id_idx" ON "recruiter_resolution_decisions"("candidate_recruiter_id");
CREATE INDEX "recruiter_resolution_decisions_requires_human_review_idx" ON "recruiter_resolution_decisions"("requires_human_review");

CREATE TABLE "recruiter_memory_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recruiter_id" UUID NOT NULL,
  "fact_type" TEXT NOT NULL,
  "fact_value" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "superseded_by_id" UUID,
  "superseded_at" TIMESTAMPTZ,
  "provenance_json" JSONB NOT NULL DEFAULT '{}',
  "evidence_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "recruiter_memory_observations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recruiter_memory_observations_recruiter_id_idx" ON "recruiter_memory_observations"("recruiter_id");
CREATE INDEX "recruiter_memory_observations_fact_type_idx" ON "recruiter_memory_observations"("fact_type");
CREATE INDEX "recruiter_memory_observations_valid_from_valid_to_idx" ON "recruiter_memory_observations"("valid_from", "valid_to");
CREATE INDEX "recruiter_memory_observations_superseded_at_idx" ON "recruiter_memory_observations"("superseded_at");

CREATE TABLE "recruiter_graph_nodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "node_type" TEXT NOT NULL,
  "external_key" TEXT,
  "label" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "recruiter_graph_nodes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recruiter_graph_node_key_unique" ON "recruiter_graph_nodes"("node_type", "external_key");
CREATE INDEX "recruiter_graph_nodes_node_type_idx" ON "recruiter_graph_nodes"("node_type");

CREATE TABLE "recruiter_graph_edges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "from_node_id" UUID NOT NULL,
  "to_node_id" UUID NOT NULL,
  "relationship_type" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_to" TIMESTAMPTZ,
  "evidence_json" JSONB NOT NULL DEFAULT '[]',
  "provenance_json" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "recruiter_graph_edges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recruiter_graph_edges_from_node_id_idx" ON "recruiter_graph_edges"("from_node_id");
CREATE INDEX "recruiter_graph_edges_to_node_id_idx" ON "recruiter_graph_edges"("to_node_id");
CREATE INDEX "recruiter_graph_edges_relationship_type_idx" ON "recruiter_graph_edges"("relationship_type");
CREATE INDEX "recruiter_graph_edges_valid_from_valid_to_idx" ON "recruiter_graph_edges"("valid_from", "valid_to");
