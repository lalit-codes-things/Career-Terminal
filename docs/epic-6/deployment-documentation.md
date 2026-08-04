# Epic 6 — Deployment Documentation

## Deployment Architecture

### Kubernetes Manifests

Located at `k8s/`.

#### Components

1. **career-terminal-api** — Main API service
2. **recruiter-intelligence-workers** — AI extraction workers
3. **recruiter-intelligence-cron** — Scheduled intelligence jobs
4. **postgresql** — Primary database with read replicas
5. **redis** — Caching and queue backend
6. **otel-collector** — OpenTelemetry trace/metric collection
7. **prometheus** — Metrics scraping
8. **grafana** — Visualization dashboards

### Deployment Strategy

#### Blue-Green Deployment

1. Deploy new version to green environment
2. Run integration tests against green
3. Switch traffic from blue to green
4. Monitor for 30 minutes
5. Decommission blue environment

#### Canary Deployment

1. Deploy new version to 10% of pods
2. Monitor error rates and latency
3. Gradually increase to 50%, then 100%
4. Rollback if error rate exceeds 1%

### Health Checks

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Resource Limits

```yaml
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

## CI/CD Pipeline

### GitHub Actions Workflow

1. **Lint & Typecheck** — ESLint + TypeScript type checking
2. **Unit Tests** — Jest unit test suite
3. **Integration Tests** — Database and API integration tests
4. **AI Evaluation Tests** — Hallucination detection, confidence calibration
5. **Build** — TypeScript compilation
6. **Security Scan** — npm audit + SAST
7. **Deploy** — Kubernetes deployment with rollback support

### Quality Gates

- All unit tests must pass
- Integration tests must pass
- AI hallucination rate < 5%
- Confidence calibration ECE < 0.1
- No critical security vulnerabilities
- Code coverage > 80%

## Environment Configuration

### Development

- Local PostgreSQL and Redis
- Stub AI providers (no real API calls)
- In-memory storage for cross-epic links
- Hot reload enabled

### Staging

- Separate PostgreSQL instance
- Test AI provider keys (sandboxed)
- Persistent cross-epic link storage
- Full observability stack

### Production

- Managed PostgreSQL with read replicas
- Production AI provider keys
- Persistent cross-epic link storage with TTL
- Full observability with alerting
- Multi-region deployment support