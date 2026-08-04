# ADR-003: Cross-Epic Intelligence Integration

## Status
Accepted

## Context

Epic 6 requires bidirectional intelligence sharing between all six intelligence modules (User, Opportunity, Application, Resume, Company, Recruiter). Previous batches implemented isolated intelligence modules with no cross-domain reasoning capabilities.

## Decision

We will implement a Cross-Epic Intelligence Integration layer that provides:
1. Bidirectional intelligence publishing and consuming between all modules
2. GraphRAG-enriched cross-domain reasoning with multi-hop traversal
3. Semantic search enrichment for cross-domain queries
4. Memory and timeline enrichment for contextual intelligence
5. Full provenance tracking and explainability for all cross-epic links

## Consequences

- All intelligence modules can now both consume and publish structured intelligence
- Cross-domain reasoning preserves provenance, confidence, evidence, and explainability
- No duplicated intelligence — deduplication ensures unique links per entity-domain pair
- TTL-based link expiration prevents stale intelligence from accumulating
- Configurable confidence thresholds control link quality

## Implementation

- `CrossEpicIntelligenceIntegrationService` — Core integration layer
- `IntelligenceBrokerService` — Multi-hop intelligence enrichment with explainability
- `EpicLinkService` — Entity-level link management with TTL and deduplication
- `CrossEpicIntelligenceLink` — Domain model for cross-epic intelligence links
- `CrossEpicIntelligenceMessage` — Domain model for cross-epic intelligence messages

## Trade-offs

- In-memory storage for cross-epic links (production would use PostgreSQL with graph tables)
- TTL-based expiration may lose valuable historical intelligence
- Multi-hop enrichment increases latency but improves reasoning quality