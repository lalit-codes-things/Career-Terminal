# ApplyWise Production Readiness

## CI/CD Gates

The GitHub Actions pipeline separates dependency validation, static analysis,
unit tests, integration tests, security scanning, application build, SBOM
generation, container build/scan, infrastructure validation, and deployment
verification. All Node installs use `npm ci` so dependency resolution is
lockfile-bound and fails on lockfile drift.

Required gates before release:

- `npm ci --ignore-scripts`
- `npx prisma generate`
- `npx prisma validate`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run test:coverage -- --runInBand`
- `npm run test:integration -- --runInBand`
- `npm audit --audit-level=high`
- Gitleaks secret scan with redaction
- Semgrep Node.js SAST scan
- Docker runtime and migrator image builds
- Runtime image non-root user verification
- Trivy image vulnerability and secret scans
- Dependency and container SBOM artifact generation
- Docker Compose and Kubernetes manifest validation
- Immutable Kubernetes image-reference validation

Pull request workflows must not receive production cloud credentials. Production
deployment must use a protected GitHub Environment with required reviewers and
short-lived workload identity credentials.

## Artifact Integrity

Release artifacts must be traceable to:

- source commit SHA
- GitHub workflow run
- `package-lock.json`
- generated dependency SBOM
- generated container SBOM
- runtime image tag or digest
- migrator image tag or digest

Kubernetes manifests must not use `latest`, `stable`, or `production` tags.
Prefer registry digests (`image@sha256:...`) for production promotion. Container
image signing is prepared as a release requirement but remains incomplete until
the target registry and admission controller are selected. Recommended path:
Cosign keyless signing with Sigstore and cluster-side signature verification.

## Secure Deployment Flow

1. Merge source change after CI validation.
2. Build runtime and migrator images from the same commit.
3. Generate and retain SBOMs and scan artifacts.
4. Scan images for high and critical vulnerabilities and embedded secrets.
5. Promote immutable image digests to staging.
6. Run the single migration Job with the migrator image.
7. Roll out API and worker Deployments.
8. Verify `/live`, `/ready`, worker startup, Redis, PostgreSQL, and storage.
9. Observe error rate, latency, queue backlog, and restart count.
10. Require production approval before promoting the same artifact digest.
11. Run post-deployment smoke checks and keep the previous digest available.

Failed verification must fail the deployment workflow. Do not mark a deployment
successful if pods are not ready, migrations fail, or health endpoints fail.

## Migration Safety

Prisma migrations are version-controlled under `prisma/migrations`. They run
through `k8s/migration-job.yaml`, not from every API or worker replica. Use
expand-and-contract migrations for rolling deployments:

- add backward-compatible columns/tables first
- deploy code that writes both old and new shapes when needed
- backfill with controlled jobs
- switch reads after verification
- remove obsolete schema only after all old code is gone

Do not run destructive migrations automatically against production without a
tested backup, explicit approval, and a forward-fix plan. Database migrations
cannot always be rolled back safely.

## Rollback Strategy

Application rollback uses the previous immutable API and worker image digest.
Configuration rollback uses the previously applied ConfigMap/Secret version.
Migration rollback is case-specific:

- backward-compatible migrations usually roll back by redeploying previous code
- destructive migrations require restore or forward correction
- bad dependency updates roll back by reverting the merge and rebuilding images
- compromised artifacts must be revoked, removed from deployment, and rotated

Each release must record previous application version, container digest,
configuration revision, migration version, and database compatibility notes.

## Observability And Alerts

Required production alerts:

- API availability and readiness failure
- elevated 5xx error rate
- elevated request latency
- worker process crash or restart loop
- queue backlog growth
- repeated BullMQ job failures
- PostgreSQL connection exhaustion
- Redis connectivity failure
- Kubernetes deployment rollout failure
- container crash loops
- CI security scanning failures
- TLS certificate expiration
- unusual authentication failure rate
- suspicious access patterns or rate-limit spikes

Alerts must include owner, severity, dashboard link, and first-response action.
Avoid paging on symptoms that self-heal without user impact.

## Disaster Recovery

ApplyWise is not yet proven multi-region production-ready. Future production
readiness requires tested recovery procedures for:

- PostgreSQL backup and point-in-time restore
- Redis queue recovery and replay/duplication behavior
- object storage restore
- secret recovery and rotation
- container registry artifact recovery
- Kubernetes manifest and infrastructure recovery
- regional traffic failover

Initial targets should be defined by the business before launch. Do not claim an
RPO or RTO until restore drills validate it. Current architecture prepares for
multi-AZ deployments, independent API/worker scaling, PgBouncer, durable object
storage, and future multi-region evolution, but actual regional failover remains
an infrastructure project.

## Production Readiness Checklist

Security:

- [ ] Authentication enforced on user endpoints
- [ ] Authorization checks validated for object ownership
- [ ] Secrets stored outside source and manifests
- [ ] JWT, internal API, OAuth, database, Redis, and encryption secrets rotated
- [ ] Encryption key management defined
- [ ] Dependency vulnerabilities triaged
- [ ] Container vulnerabilities triaged
- [ ] Secret scanning enabled in PR and push workflows
- [ ] SAST findings triaged by severity
- [ ] Vulnerability response owner assigned

Reliability:

- [ ] `/live` and `/ready` wired to load balancers
- [ ] Graceful shutdown verified for API and workers
- [ ] Retries and timeouts configured for external dependencies
- [ ] Queue jobs are idempotent
- [ ] Database connection limits fit PgBouncer and PostgreSQL capacity
- [ ] Rollback procedure tested

Scalability:

- [ ] API can scale horizontally
- [ ] Workers scale independently by queue
- [ ] PgBouncer is deployed for application traffic
- [ ] Redis capacity and persistence model selected
- [ ] Multi-AZ scheduling configured
- [ ] Multi-region design documented before global launch

Operations:

- [ ] Structured logs routed to centralized logging
- [ ] Metrics scraped and dashboarded
- [ ] Traces exported where configured
- [ ] Alerts mapped to runbooks
- [ ] Incident response process defined
- [ ] Backup and restore drills scheduled

Delivery:

- [ ] CI required on protected branches
- [ ] CD separated for staging and production
- [ ] Production environment requires approval
- [ ] SBOM artifacts retained
- [ ] Image signing implemented before production launch
- [ ] Deployments use immutable image references
- [ ] Smoke tests verify deployment health

## Current Verdict

Production hardening is improved, but final production readiness is not fully
claimable until cloud identity, image signing, protected production deployment,
observability dashboards, alert routing, and disaster-recovery drills are
implemented and verified in the target environment.
