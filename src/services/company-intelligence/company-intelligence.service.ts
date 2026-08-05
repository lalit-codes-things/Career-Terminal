/**
 * CompanyIntelligenceService
 *
 * Routes the three rule-based scoring paths (stability, authenticity, hiring
 * signals) through AI capabilities instead of hard-coded heuristics.
 *
 * Each scorer:
 *   1. Gathers existing structured data about the company from the DB
 *   2. Calls planner(understand/infer/predict) with that content
 *   3. Returns the AI-scored result alongside the legacy stub response
 *      so callers can transition gradually
 *
 * No new tables — outputs land in Prediction rows (via planner) and
 * CompanySignal rows where applicable.
 */

import { prisma } from '../../config/database';
import { planner } from '../planner';

export interface CompanyScoreResult {
  companyId: string;
  score: number;
  confidence: number;
  signals: string[];
  planId: string;
  latencyMs: number;
}

export class CompanyIntelligenceService {
  /**
   * Stability score — is this company financially stable and actively operating?
   * Replaces the rule-based score(0) stub in api.service.ts.
   */
  async scoreStability(companyId: string, userId: string): Promise<CompanyScoreResult> {
    const start = Date.now();
    const context = await this.buildCompanyContext(companyId);

    const result = await planner.run({
      userId,
      entityId: companyId,
      entityType: 'company',
      content: JSON.stringify({ task: 'stability_score', ...context }),
      intent: 'predict',
      plannerContext: { scoringType: 'stability', companyId },
    });

    const scoreField = result.results
      .flatMap((r) => r.fields)
      .find((f) => f.name.toLowerCase().includes('score') || f.name.toLowerCase().includes('stable'));

    return {
      companyId,
      score: scoreField ? Number(scoreField.value) || result.results[0]?.confidence ?? 0 : 0,
      confidence: result.results[0]?.confidence ?? 0,
      signals: result.results.flatMap((r) => r.fields.map((f) => `${f.name}: ${JSON.stringify(f.value)}`)),
      planId: result.planId,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Authenticity score — is this a legitimate company, not a scam or ghost company?
   */
  async scoreAuthenticity(companyId: string, userId: string): Promise<CompanyScoreResult> {
    const start = Date.now();
    const context = await this.buildCompanyContext(companyId);

    const result = await planner.run({
      userId,
      entityId: companyId,
      entityType: 'company',
      content: JSON.stringify({ task: 'authenticity_score', ...context }),
      intent: 'verify',
      plannerContext: { scoringType: 'authenticity', companyId },
    });

    const scoreField = result.results
      .flatMap((r) => r.fields)
      .find((f) => f.name.toLowerCase().includes('trust') || f.name.toLowerCase().includes('authentic'));

    return {
      companyId,
      score: scoreField ? Number(scoreField.value) || result.results[0]?.confidence ?? 0.5 : 0.5,
      confidence: result.results[0]?.confidence ?? 0,
      signals: result.results.flatMap((r) => r.fields.map((f) => `${f.name}: ${JSON.stringify(f.value)}`)),
      planId: result.planId,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Hiring signals — is this company actively hiring in relevant areas?
   */
  async scoreHiringSignals(companyId: string, userId: string): Promise<CompanyScoreResult & { activeSignals: string[] }> {
    const start = Date.now();
    const context = await this.buildCompanyContext(companyId);

    // Also fetch existing CompanySignal rows for context
    const existingSignals = await prisma.companySignal.findMany({
      where: { companyId },
      orderBy: { discoveryTime: 'desc' },
      take: 10,
      select: { signalType: true, headline: true, confidence: true, discoveryTime: true },
    });

    const result = await planner.run({
      userId,
      entityId: companyId,
      entityType: 'company',
      content: JSON.stringify({
        task: 'hiring_signal_score',
        existingSignals: existingSignals.map((s) => `[${s.signalType}] ${s.headline}`),
        ...context,
      }),
      intent: 'infer',
      plannerContext: { scoringType: 'hiring_signals', companyId },
    });

    const hiringFields = result.results
      .flatMap((r) => r.fields)
      .filter((f) => f.name.toLowerCase().includes('hiring') || f.name.toLowerCase().includes('signal'));

    const activeSignals = [
      ...existingSignals.map((s) => s.headline),
      ...hiringFields.map((f) => String(f.value)),
    ].filter(Boolean);

    return {
      companyId,
      score: result.results[0]?.confidence ?? 0,
      confidence: result.results[0]?.confidence ?? 0,
      signals: result.results.flatMap((r) => r.fields.map((f) => `${f.name}: ${JSON.stringify(f.value)}`)),
      activeSignals,
      planId: result.planId,
      latencyMs: Date.now() - start,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async buildCompanyContext(companyId: string): Promise<Record<string, unknown>> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        domain: true,
        industry: true,
        headquarters: true,
        website: true,
      },
    }).catch(() => null);

    if (!company) return { companyId };

    return {
      companyId,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      headquarters: company.headquarters,
      website: company.website,
    };
  }
}

export const companyIntelligenceService = new CompanyIntelligenceService();
