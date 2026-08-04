# Epic 6 — Operational Documentation

## Monitoring

### Key Metrics

#### AI Quality Metrics
- Extraction confidence distribution
- Hallucination rate per template
- Confidence calibration error (ECE)
- Brier score per model
- Evidence fidelity score
- Provenance completeness rate

#### Performance Metrics
- Extraction latency (p50, p95, p99)
- Token usage per extraction
- Cost per extraction
- AI provider response time
- Rate limit utilization

#### Cross-Epic Integration Metrics
- Total cross-epic links
- Active cross-epic links by domain
- Cross-epic link confidence distribution
- Messages processed per entity
- Link expiration rate

### Alerting

#### Critical Alerts
- Hallucination rate exceeds threshold
- AI provider unavailable
- Cross-epic link confidence below minimum
- Extraction pipeline failure rate > 5%

#### Warning Alerts
- Confidence calibration error > 0.15
- Token usage exceeding budget
- Cross-epic link count approaching limit
- Stale links exceeding TTL

### Dashboards

#### AI Quality Dashboard
- Real-time extraction confidence
- Hallucination detection results
- Provider comparison scores
- Model evaluation trends
- Prompt experiment results

#### Cross-Epic Intelligence Dashboard
- Intelligence flow between modules
- Domain coverage heatmap
- Confidence distribution by epic
- Link freshness metrics

## Maintenance

### Regular Tasks

1. **Link Cleanup** — Run `removeExpiredLinks()` daily to prune stale cross-epic links
2. **Model Evaluation** — Run benchmark suites weekly to validate model performance
3. **Prompt Review** — Review prompt experiment results monthly
4. **Calibration Check** — Verify confidence calibration monthly
5. **Provider Health** — Monitor AI provider availability and latency daily

### Database Maintenance

```sql
-- Archive old cross-epic links
DELETE FROM cross_epic_links WHERE created_at < NOW() - INTERVAL '30 days';

-- Update materialized views for semantic retrieval
REFRESH MATERIALIZED VIEW semantic_search_index;

-- Rebuild graph edge indexes
REINDEX INDEX idx_recruiter_graph_edges;
```

## Deployment

### Prerequisites

- Kubernetes cluster with 3+ nodes
- PostgreSQL 14+ with read replicas
- Redis 7.0+ cluster
- Object storage (S3-compatible) for file uploads
- TLS certificates for all endpoints

### Environment Variables

```env
# AI Providers
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
VERTEX_PROJECT_ID=...

# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Feature Flags
CROSS_EPIC_INTEGRATION_ENABLED=true
AI_QUALITY_ENABLED=true
HALLUCINATION_DETECTION_ENABLED=true

# Rate Limiting
AI_RATE_LIMIT_MAX_TOKENS=4096
AI_RATE_LIMIT_MAX_CALLS_PER_MINUTE=60

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
PROMETHEUS_PORT=9090
```

### Scaling

#### Horizontal Scaling
- Application services scale statelessly
- AI extraction workers scale based on queue depth
- Vector search scales with read replicas

#### Vertical Scaling
- AI extraction: increase memory for large batch processing
- GraphRAG: increase CPU for multi-hop traversal
- Semantic search: increase memory for embedding cache

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/career-terminal

# Rollback database migration
prisma migrate resolve --rolled-back <migration_name>
```