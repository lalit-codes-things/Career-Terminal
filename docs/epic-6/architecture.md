# Epic 6 — Architecture Documentation

## Overview

Career Terminal Epic 6 implements a comprehensive Recruiter Intelligence platform designed for 1+ billion users. The architecture is built on a domain-driven design with explicit module boundaries, event-driven orchestration, and provider-independent AI integration.

## Architecture Layers

1. **API Layer** — Handles commands, queries, and admin operations
2. **Application Layer** — Orchestrates workflows across modules, emits domain events
3. **Domain Layer** — Contains aggregates, entities, value objects, services, and contracts
4. **Infrastructure Layer** — Repositories, event publishers, queue adapters, AI provider integrations
5. **Worker Layer** — Consumes queue events for asynchronous enrichment, extraction, and indexing

## Bounded Contexts

| Context | Responsibility |
|---------|---------------|
| Identity Resolution | Canonical identity matching and resolution |
| Knowledge Graph | Graph-based relationship modeling |
| Communication Intelligence | Email/message parsing and intelligence |
| Relationship Intelligence | Recruiter-candidate relationship modeling |
| Behavior Intelligence | Behavioral pattern inference |
| Organization Intelligence | Company and org structure intelligence |
| Timeline | Temporal event tracking |
| Memory | Bi-temporal fact storage and retrieval |
| Search | Semantic and keyword retrieval |
| AI | Provider-independent extraction and reasoning |
| Reputation | Trust and scoring |
| Specialization | Expertise inference |
| Decision Intelligence | Prediction and probability modeling |
| Insights | Actionable intelligence synthesis |
| Semantic Representation | Embedding and vector operations |
| Vector Search | Hybrid retrieval |
| GraphRAG | Graph-augmented retrieval generation |
| Context Orchestration | Token-optimized context assembly |
| Reasoning Orchestrator | Multi-step AI reasoning workflows |
| Copilot | Conversational intelligence assistant |
| Autonomous Intelligence | Proactive monitoring and alerting |
| Cross-Epic Integration | Bidirectional intelligence sharing across all 6 intelligence modules |
| AI Quality | Evaluation, observability, and continuous improvement |

## Cross-Epic Integration

The Cross-Epic Intelligence Integration layer (Prompt 28) provides bidirectional intelligence sharing between all six intelligence modules:

- **User Intelligence** ↔ **Recruiter Intelligence**
- **Recruiter Intelligence** ↔ **Company Intelligence**
- **Company Intelligence** ↔ **Opportunity Intelligence**
- **Opportunity Intelligence** ↔ **Application Intelligence**
- **Recruiter Intelligence** ↔ **Interview Intelligence**
- **Resume Intelligence** ↔ **Recruiter Intelligence**
- **Resume Intelligence** ↔ **Skills Intelligence**
- **Application Intelligence** ↔ **Communication Intelligence**

Every integration preserves provenance, confidence, evidence, and explainability.

## AI Quality Infrastructure

The AI Quality infrastructure (Prompt 29) provides:

- **Evaluation Framework** — Offline, online, regression, and benchmark evaluation phases
- **Prompt Versioning & Registry** — Versioned prompt templates with experiment support
- **Model Registry** — Provider-independent model registration and comparison
- **Hallucination Detection** — Automated evidence-based hallucination detection
- **Confidence Calibration** — ECE, Brier score, and reliability diagram computation
- **Tracing** — OpenTelemetry-compatible span tracing with inference logging
- **Feedback Pipeline** — Structured feedback collection and rating
- **Benchmark Suite** — Regression testing and provider/model/prompt comparison

## Key Design Decisions

1. **PostgreSQL-first, graph-ready** — ADR-002 ensures relational storage with future graph compatibility
2. **Provider-independent AI** — No hardcoded AI providers; all AI decisions are explainable, evidence-backed, and auditable
3. **Event-driven orchestration** — All state transitions are event-driven with outbox-compatible publishing
4. **Bi-temporal facts** — First-class temporal concepts with validFrom/validTo semantics
5. **No circular dependencies** — Bounded contexts communicate through explicit contracts and events

## Scalability

- Horizontal scaling via stateless application services
- Partitioning for large fact tables
- Materialized views for analytics and semantic retrieval acceleration
- Queue-based async processing for AI extraction pipelines
- Token-bucket rate limiting for AI provider calls

## Reliability

- Circuit breaker pattern for external AI provider calls
- Retry with exponential backoff for transient failures
- Dead letter queue for failed extractions
- Human review queue for low-confidence outputs
- Graceful degradation when AI providers are unavailable

## Security & Privacy

- All recruiter data treated as sensitive and privacy-regulated
- Consent tracked at evidence level
- Support for deletion and region-based restrictions
- PII inventory and data protection infrastructure
- RLS (Row Level Security) middleware for data access control