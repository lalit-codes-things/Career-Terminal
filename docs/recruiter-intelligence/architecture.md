# Recruiter Intelligence Architecture Foundation

## Overview

This foundation establishes a domain-driven architecture for Recruiter Intelligence that is intentionally scalable, event-driven, provenance-aware, and future-proof. It is designed to support global-scale recruiter knowledge systems without requiring architectural rewrites.

## Bounded Contexts

- Identity Resolution
- Knowledge Graph
- Communication Intelligence
- Relationship Intelligence
- Behavior Intelligence
- Organization Intelligence
- Timeline
- Memory
- Search
- AI / Extraction / Embedding

## Core Principles

- Domain-driven design with explicit module boundaries.
- No circular dependencies between bounded contexts.
- All state transitions are event-driven and provenance-aware.
- Bi-temporal facts are first-class concepts.
- AI integration remains provider-independent.
- PostgreSQL is the base system of record and remains compatible with future graph or analytics expansion.

## Architectural Layers

1. API layer
   - Handles commands, queries, and admin operations.
   - Delegates to application services.

2. Application layer
   - Orchestrates workflows across modules.
   - Emits domain events and commands.

3. Domain layer
   - Contains aggregates, entities, value objects, services, and contracts.
   - Encodes business invariants and temporal semantics.

4. Infrastructure layer
   - Repositories, event publishers, queue adapters, storage connectors, and AI provider integrations.

5. Worker layer
   - Consumes queue events and performs asynchronous enrichment, extraction, and indexing.

## Event Architecture

- Use versioned domain events.
- Use outbox-compatible publishing.
- Ensure idempotent command execution.
- Support retries and DLQ patterns.
- Maintain compatibility with future Kafka-based transport.

## Data Architecture

- PostgreSQL remains the primary operational store.
- Use partitioning for large fact tables.
- Create indexes for identity, graph traversal, temporal lookup, and evidence correlation.
- Use materialized views for analytics and semantic retrieval acceleration.
- Design for future horizontal scaling and sharding compatibility.

## Security & Governance

- Treat all recruiter data as sensitive and privacy-regulated.
- Separate auth, authorization, encryption, and retention concerns.
- Track consent at the evidence level.
- Support deletion and region-based restrictions.

## Observability

- Emit OpenTelemetry traces and metrics.
- Track queue depth, worker latency, AI latency, extraction confidence, and event lag.
- Maintain structured logs for all ingestion and enrichment pipelines.
