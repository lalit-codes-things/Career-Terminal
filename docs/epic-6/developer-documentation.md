# Epic 6 — Developer Documentation

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL >= 14
- Redis >= 7.0 (optional, for caching)

### Installation

```bash
npm install
npm run db:generate
npm run db:migrate
```

### Running Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# AI evaluation tests
npm test -- --testPathPattern=ai-quality

# Cross-epic integration tests
npm test -- --testPathPattern=cross-epic

# Performance tests
npm test -- --testPathPattern=performance
```

### Building

```bash
npm run build
npm start
```

## Key Services

### Recruiter Intelligence

Located at `src/services/recruiter-intelligence/`.

#### Core Services

| Service | Path | Description |
|---------|------|-------------|
| Entity Extraction | `extraction/recruiter-entity-extraction.service.ts` | Extracts recruiter entities from communications |
| Intelligence Engine | `engine/recruiter-intelligence-engine.service.ts` | Generates full recruiter intelligence profiles |
| Communication | `communication/communication.service.ts` | Ingests and processes recruiter communications |
| Memory | `memory/recruiter-memory.service.ts` | Bi-temporal fact storage and retrieval |
| Knowledge Graph | `graph/recruiter-knowledge-graph.service.ts` | Graph-based relationship modeling |
| GraphRAG | `graph-rag/graph-rag.service.ts` | Graph-augmented retrieval generation |
| Reasoning | `reasoning/recruiter-reasoning-enrichment.service.ts` | AI-assisted attribute inference |
| Behavioral Intelligence | `behavioral/recruiter-behavioral-intelligence.service.ts` | Behavioral pattern inference |
| Decision Intelligence | `decision/recruiter-decision-intelligence.service.ts` | Decision probability prediction |
| Reputation & Trust | `reputation/recruiter-reputation-trust.service.ts` | Trust scoring and reputation analysis |
| Specialization | `specialization/recruiter-specialization-intelligence.service.ts` | Expertise inference |
| Insights Engine | `insights/recruiter-insights-engine.service.ts` | Actionable intelligence synthesis |
| Copilot | `copilot/recruiter-copilot.service.ts` | Conversational intelligence assistant |
| Autonomous Intelligence | `autonomous/autonomous-intelligence.service.ts` | Proactive monitoring and alerting |
| Context Orchestration | `context-orchestration/context-orchestrator.service.ts` | Token-optimized context assembly |

#### Cross-Epic Integration (Prompt 28)

| Service | Path | Description |
|---------|------|-------------|
| Cross-Epic Integration | `cross-epic/cross-epic-integration.service.ts` | Bidirectional intelligence sharing |
| Intelligence Broker | `cross-epic/intelligence-broker.service.ts` | Multi-hop intelligence enrichment |
| Epic Link | `cross-epic/epic-link.service.ts` | Entity-level link management |

#### AI Quality (Prompt 29)

| Service | Path | Description |
|---------|------|-------------|
| Evaluation Framework | `ai-quality/evaluation-framework.service.ts` | Multi-phase AI evaluation |
| Prompt Registry | `ai-quality/prompt-registry.service.ts` | Versioned prompt management |
| Model Registry | `ai-quality/model-registry.service.ts` | Provider-independent model registration |
| Hallucination Detector | `ai-quality/hallucination-detector.service.ts` | Automated hallucination detection |
| Confidence Calibrator | `ai-quality/confidence-calibrator.service.ts` | Calibration error and ECE computation |
| Tracing | `ai-quality/tracing.service.ts` | Span-based AI tracing |
| Feedback Pipeline | `ai-quality/feedback-pipeline.service.ts` | Structured feedback collection |
| Benchmark Suite | `ai-quality/benchmark-suite.service.ts` | Regression testing and comparison |

## Domain Contracts

Located at `src/domain/recruiter-intelligence/`.

### Shared Kernel

- `shared-kernel/types.ts` — Core types: `RecruiterId`, `ConfidenceBand`, `Provenance`, `EvidenceRef`, `TemporalFact`

### Bounded Context Contracts

Each bounded context has a `contracts.ts` file defining its domain types and interfaces.

## AI Infrastructure

Located at `src/services/recruiter-intelligence/ai/`.

- `types.ts` — AI provider types, prompt templates, extraction I/O
- `prompt-manager.ts` — Prompt template versioning and rendering
- `extraction-pipeline.ts` — Central AI orchestration engine
- `adapters/` — Provider-specific adapters (OpenAI, Anthropic, Vertex, Stub)
- `output-validator.ts` — Structured output validation
- `human-review.ts` — Human review queue for low-confidence outputs
- `cost-tracker.ts` — Token and cost tracking
- `rate-limiter.ts` — Token bucket rate limiting

## Configuration

All services use configuration objects passed via constructor options. No hardcoded values.

### Key Configuration Options

- `confidenceThreshold` — Minimum confidence for cross-epic links (default: 0.30)
- `maxLinksPerEntity` — Maximum links per entity (default: 50)
- `maxMessagesPerEntity` — Maximum messages per entity (default: 200)
- `defaultTtlMs` — Link time-to-live (default: 7 days)
- `deduplicationEnabled` — Enable link deduplication (default: true)
- `provenanceTrackingEnabled` — Enable provenance tracking (default: true)
- `explainabilityEnabled` — Enable explainability chain generation (default: true)