/**
 * Company import pipeline — the framework that runs a provider import.
 *
 * Orchestrates the full path for one provider:
 *
 *   plan → create run → fetch records (provider generator)
 *       → normalize → validate → resolve → persist (per record)
 *   → complete run → update provider metadata
 *
 * The importer never knows which provider it is running: it depends only on
 * the `CompanyProvider` interface, the `CompanyIntelRepository` and the pure
 * normalization/validation/resolution helpers. It also never performs large
 * imports itself — providers stream records through the shared generator
 * contract, so memory stays bounded for bulk datasets.
 *
 * A future BullMQ worker can call `executeImportJob(job)` directly; the
 * payload contract (`ImportJobPayload`) is designed for that.
 */

import type { Logger } from '../../../lib/logger';
import { logger as appLogger } from '../../../lib/logger';
import { CompanyEntityResolver } from '../entities';
import type { CompanyProvider, CompanyProviderRegistry } from '../providers';
import type { CompanyIntelRepository } from '../repository';
import { companyRecordNormalizer, type CompanyRecordNormalizer } from '../normalization';
import { companyValidator, type CompanyValidator } from '../validation';
import { buildImportPlan } from './import-planner';
import type {
  ImportJobPayload,
  ImportRunCounts,
  ImportRunOptions,
  ImportRunResult,
} from './importer.types';

export interface CompanyImporterDeps {
  registry: CompanyProviderRegistry;
  repository: CompanyIntelRepository;
  normalizer?: CompanyRecordNormalizer;
  validator?: CompanyValidator;
  resolver?: CompanyEntityResolver;
  logger?: Logger;
}

interface RunContext {
  runId: string;
  counts: ImportRunCounts;
  errorMessages: string[];
}

export class CompanyImporter {
  private readonly registry: CompanyProviderRegistry;
  private readonly repository: CompanyIntelRepository;
  private readonly normalizer: CompanyRecordNormalizer;
  private readonly validator: CompanyValidator;
  private readonly resolver: CompanyEntityResolver;
  private readonly logger: Logger;

  constructor(deps: CompanyImporterDeps) {
    this.registry = deps.registry;
    this.repository = deps.repository;
    this.normalizer = deps.normalizer ?? companyRecordNormalizer;
    this.validator = deps.validator ?? companyValidator;
    this.resolver = deps.resolver ?? new CompanyEntityResolver(this.repository);
    this.logger = deps.logger ?? appLogger;
  }

  /** Entry point for queue workers. */
  async executeImportJob(job: ImportJobPayload): Promise<ImportRunResult> {
    return this.runImport({ ...job });
  }

  async runImport(options: ImportRunOptions): Promise<ImportRunResult> {
    const provider = this.registry.get(options.providerKey);
    if (!provider) {
      throw new Error(`CompanyImporter: no provider registered with key '${options.providerKey}'`);
    }

    const available = await provider.isAvailable();
    const plan = buildImportPlan(options, { provider, available });
    const importType = options.importType ?? 'FULL';
    const startedAt = new Date();

    if (plan.reason !== 'ok') {
      this.logger.info('[CompanyIntel] import skipped', {
        providerKey: options.providerKey,
        reason: plan.reason,
        detail: plan.reasonText,
      });
      return this.skippedResult(options, provider, importType, startedAt, plan.reasonText ?? '');
    }

    this.logger.info('[CompanyIntel] import started', {
      providerKey: options.providerKey,
      importType,
      since: options.since ?? null,
      dryRun: options.dryRun ?? false,
      correlationId: options.correlationId ?? undefined,
    });

    const run = await this.repository.createImportRun({
      providerKey: options.providerKey,
      importType,
      since: options.since ?? null,
      correlationId: options.correlationId ?? null,
      metadata: {
        dryRun: options.dryRun ?? false,
        limit: options.limit ?? null,
        maxRecords: options.maxRecords ?? null,
      },
    });

    const context: RunContext = {
      runId: run.id,
      counts: this.emptyCounts(),
      errorMessages: [],
    };

    try {
      await this.processRecords(provider, options, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.errorMessages.push(message);
      this.logger.error('[CompanyIntel] import failed', {
        providerKey: options.providerKey,
        runId: run.id,
        error: message,
      });
    }

    const status: 'success' | 'partial' | 'failed' =
      context.counts.errors > 0
        ? 'partial'
        : context.errorMessages.length > 0
          ? 'failed'
          : 'success';

    const completedAt = new Date();
    await this.repository.completeImportRun(run.id, {
      status,
      completedAt,
      ...this.countsToCompleteInput(context.counts),
      error: context.errorMessages[0] ?? null,
    });

    await this.repository.upsertProviderMetadata({
      providerKey: options.providerKey,
      name: provider.name,
      version: provider.version,
      jurisdiction: provider.jurisdiction,
      enabled: provider.enabled,
      status: status === 'success' ? 'healthy' : 'degraded',
      lastRunAt: completedAt.toISOString(),
      lastRunStatus: status,
      lastError: context.errorMessages[0] ?? null,
    });

    this.logger.info('[CompanyIntel] import completed', {
      providerKey: options.providerKey,
      runId: run.id,
      status,
      counts: context.counts,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });

    return {
      providerKey: options.providerKey,
      importType,
      runId: run.id,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status,
      counts: context.counts,
      error: context.errorMessages[0],
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  // ── Record processing ───────────────────────────────────────────────────

  private async processRecords(
    provider: CompanyProvider,
    options: ImportRunOptions,
    context: RunContext,
  ): Promise<void> {
    const dryRun = options.dryRun ?? false;

    for await (const record of provider.fetchRecords({
      since: options.since,
      limit: options.limit,
      searchTerms: options.searchTerms,
      companyNumbers: options.companyNumbers,
      maxRecords: options.maxRecords,
    })) {
      context.counts.fetched += 1;

      try {
        const normalized = this.normalizer.normalize(record.data, {
          providerKey: record.providerKey,
          providerRecordId: record.providerRecordId,
          fetchedAt: record.fetchedAt,
          checksum: record.checksum,
          rawReference: record.rawReference,
        });

        const report = this.validator.validate(normalized);
        if (report.hasErrors) {
          context.counts.failedValidation += 1;
          this.logger.warn('[CompanyIntel] record failed validation', {
            providerKey: options.providerKey,
            providerRecordId: record.providerRecordId,
            issues: report.issues.map((issue) => `${issue.code}:${issue.field}`),
          });
          if (!dryRun) {
            await this.repository.recordProviderRecord({
              importRunId: context.runId,
              providerKey: record.providerKey,
              providerRecordId: record.providerRecordId,
              fetchedAt: record.fetchedAt,
              checksum: record.checksum,
              rawReference: record.rawReference,
              status: 'validation_failed',
              error: report.issues.map((issue) => `${issue.code}: ${issue.message}`).join(' | '),
            });
          }
          continue;
        }

        context.counts.validated += 1;
        const resolution = await this.resolver.resolve(normalized);

        if (dryRun) {
          // Validate + resolve only; nothing is persisted (caller uses an
          // in-memory repository for fully non-durable dry runs).
          context.counts.matched += resolution.matched ? 1 : 0;
          continue;
        }

        const result = await this.repository.persistCompany(normalized, resolution);
        if (result.created) {
          context.counts.created += 1;
        } else if (result.updated) {
          context.counts.updated += 1;
        }
        if (result.matched) {
          context.counts.matched += 1;
        }

        await this.repository.recordProviderRecord({
          importRunId: context.runId,
          canonicalCompanyId: result.canonicalCompanyId,
          providerKey: record.providerKey,
          providerRecordId: record.providerRecordId,
          fetchedAt: record.fetchedAt,
          checksum: record.checksum,
          rawReference: record.rawReference,
          status: 'processed',
        });

        await this.repository.appendAuditLog({
          entityType: 'canonical_company',
          entityId: result.canonicalCompanyId,
          action: result.created ? 'import.created' : result.updated ? 'import.updated' : 'import.matched',
          actor: `import:${options.providerKey}`,
          metadata: {
            providerRecordId: record.providerRecordId,
            matchedBy: result.matchedBy,
            runId: context.runId,
          },
        });
      } catch (err) {
        context.counts.errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        context.errorMessages.push(message);
        this.logger.error('[CompanyIntel] record failed', {
          providerKey: options.providerKey,
          providerRecordId: record.providerRecordId,
          error: message,
        });
        if (!dryRun) {
          await this.repository.recordProviderRecord({
            importRunId: context.runId,
            providerKey: record.providerKey,
            providerRecordId: record.providerRecordId,
            fetchedAt: record.fetchedAt,
            checksum: record.checksum,
            rawReference: record.rawReference,
            status: 'error',
            error: message,
          });
        }
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async skippedResult(
    options: ImportRunOptions,
    provider: CompanyProvider,
    importType: ImportRunOptions['importType'],
    startedAt: Date,
    reason: string,
  ): Promise<ImportRunResult> {
    const completedAt = new Date();
    const counts = this.emptyCounts();

    // Record skipped runs so provider metadata reflects the attempt.
    const run = await this.repository.createImportRun({
      providerKey: options.providerKey,
      importType: importType ?? 'FULL',
      since: options.since ?? null,
      correlationId: options.correlationId ?? null,
    });
    await this.repository.completeImportRun(run.id, {
      status: 'skipped',
      completedAt,
      ...this.countsToCompleteInput(counts),
      error: reason,
    });
    await this.repository.upsertProviderMetadata({
      providerKey: options.providerKey,
      name: provider.name,
      version: provider.version,
      jurisdiction: provider.jurisdiction,
      enabled: provider.enabled,
      status: provider.enabled ? 'unknown' : 'disabled',
      lastRunAt: completedAt.toISOString(),
      lastRunStatus: 'skipped',
      lastError: reason,
    });

    return {
      providerKey: options.providerKey,
      importType: importType ?? 'FULL',
      runId: run.id,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: 'skipped',
      counts,
      error: reason,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  private emptyCounts(): ImportRunCounts {
    return {
      fetched: 0,
      validated: 0,
      failedValidation: 0,
      created: 0,
      updated: 0,
      matched: 0,
      errors: 0,
    };
  }

  private countsToCompleteInput(counts: ImportRunCounts): {
    recordsFetched: number;
    recordsValidated: number;
    recordsFailedValidation: number;
    companiesCreated: number;
    companiesUpdated: number;
    companiesMatched: number;
    errors: number;
  } {
    return {
      recordsFetched: counts.fetched,
      recordsValidated: counts.validated,
      recordsFailedValidation: counts.failedValidation,
      companiesCreated: counts.created,
      companiesUpdated: counts.updated,
      companiesMatched: counts.matched,
      errors: counts.errors,
    };
  }
}

/** Default importer wired to the app's registry, repository and singletons. */
export function createCompanyImporter(deps: {
  registry: CompanyProviderRegistry;
  repository: CompanyIntelRepository;
}): CompanyImporter {
  return new CompanyImporter(deps);
}
