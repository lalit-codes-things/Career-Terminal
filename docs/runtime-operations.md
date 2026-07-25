# Runtime operations

## Workload model

The portable runtime image runs the API (`node dist/index.js`) or workers
(`node dist/services/queue/workers/index.js`), and the controlled migration
Job (`npx prisma migrate deploy`). CI publishes the Dockerfile `migrator`
target separately because it alone retains the Prisma CLI and migration schema.
The API only enqueues BullMQ work. Workers
may be scaled independently and `WORKER_QUEUES` can select one or more of
`email`, `resume-parsing`, and `application-tracking` for workload isolation.
Set `WORKER_CONCURRENCY` conservatively; increase replicas before increasing
per-pod concurrency.

The API `/live` endpoint verifies only that the process is alive. `/ready`
checks PostgreSQL, Redis, and storage, and returns unavailable while draining.
Use `/live` for liveness and `/ready` for load-balancer readiness. Health
responses contain no secret or customer data.

## Database, Redis, and deploys

Use PgBouncer transaction pooling for application traffic. Every API or worker
process is capped by `DATABASE_CONNECTION_LIMIT` (default 5), with
`DATABASE_POOL_TIMEOUT` and `DATABASE_CONNECT_TIMEOUT` controlling bounded
failure. Prisma migrations must run as the single Kubernetes Job before a
rolling rollout, using backward-compatible expand/contract sequencing.

BullMQ jobs are at-least-once. Producers retain bounded completed and failed
records, retry three times with exponential backoff, and workers close on
SIGTERM before the pod grace period expires. Job processors must remain
idempotent: use database uniqueness/upserts for effects that can be replayed.
Alert on queue depth, failed-job count, retry rate, worker restarts, Redis
errors, pool exhaustion, readiness failures, and API latency/error rate.

## Security and availability

Images run as UID 1001 and Kubernetes pods deny privilege escalation, drop all
Linux capabilities, and use a read-only filesystem with only `/tmp` writable.
Do not put real secrets in manifests. Production should inject narrowly scoped
secrets through External Secrets/Vault plus workload identity; rotate by a
rolling restart. Database, Redis, and object storage stay on private networks.

Deploy API replicas across availability zones with the supplied PDB, spread
worker pools independently, and keep durable state in PostgreSQL, Redis, and
object storage—not local disks. Regional failover remains an operator concern:
use regional queues/storage, a tested PostgreSQL failover plan, and a global
traffic layer. Redis or database loss can make jobs retry/duplicate; it does
not provide a zero-data-loss guarantee.
