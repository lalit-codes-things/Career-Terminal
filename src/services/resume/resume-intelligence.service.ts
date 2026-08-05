/**
 * ResumeIntelligenceService
 *
 * Routes resume analysis through the AI capability pipeline.
 *
 * Flow:
 *   buffer → DocumentExtractionService (raw text)
 *          → planner(extract) → FactObservation rows
 *          → hybridRetrievalService.embed (pgvector)
 *          → ParseIntelligenceResult
 */

import { randomUUID } from 'crypto';
import { DocumentExtractionService } from '../document/document-extraction.service';
import { planner } from '../planner';
import { hybridRetrievalService } from '../recruiter-intelligence/vector-search/hybrid-retrieval.service';
import { factService } from '../fact.service';
import { prisma } from '../../config/database';

export interface ParseIntelligenceResult {
  userResumeId: string;
  factIds: string[];
  planId: string;
  fields: Array<{ name: string; value: unknown; confidence: number }>;
  embeddingStored: boolean;
  latencyMs: number;
}

export class ResumeIntelligenceService {
  private readonly extractor = new DocumentExtractionService();

  async analyzeBuffer(
    buffer: Buffer,
    mimeType: string,
    userId: string,
    userResumeId: string,
  ): Promise<ParseIntelligenceResult> {
    const start = Date.now();

    // 1. Extract raw text — DocumentExtractionService only, no rule-based parsing
    const { rawText } = await this.extractor.extract(buffer, mimeType);

    // 2. Run planner → extract capability → writes Prediction rows
    const planResult = await planner.run({
      userId,
      entityId: userResumeId,
      entityType: 'resume',
      content: rawText.slice(0, 8000),
      intent: 'extract',
      plannerContext: { userResumeId, mimeType },
    });

    // 3. Persist findings as FactObservation rows (candidate domain)
    const factIds: string[] = [];
    const modelId = 'deepseek-chat';

    // Create extraction run for provenance
    let extractionRunCtx: { runId: string; provenanceId: string } | null = null;
    try {
      extractionRunCtx = await factService.createExtractionRun({
        userId,
        modelId,
        modelProvider: 'deepseek',
        modelVersion: 'v3',
        sourceType: 'RESUME',
        sourceId: userResumeId,
        parserVersion: 'resume-intelligence-v1',
        schemaVersion: 'v1',
      });
    } catch {
      // Non-fatal — facts won't have provenance
    }

    for (const capResult of planResult.results) {
      for (const field of capResult.fields) {
        if (field.confidence < 0.4) continue;
        try {
          if (extractionRunCtx) {
            const fact = await factService.recordFact({
              userId,
              extractionRunId: extractionRunCtx.runId,
              provenanceId: extractionRunCtx.provenanceId,
              factType: `resume.${field.name}`,
              factData: { value: field.value, confidence: field.confidence, evidence: field.evidence },
              sourceType: 'RESUME',
              sourceId: userResumeId,
              extractionMethod: 'LLM',
              modelVersion: 'deepseek-v3',
              confidence: field.confidence,
              evidenceReference: field.evidence.slice(0, 500),
              observedAt: new Date(),
            });
            factIds.push(fact.id);
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // 4. Embed resume text into pgvector for future similarity search
    let embeddingStored = false;
    try {
      await hybridRetrievalService.embed(
        rawText.slice(0, 4000),
        userResumeId,
        'resume',
        userId,
      );
      embeddingStored = true;
    } catch {
      // Non-fatal — similarity search degrades gracefully without embedding
    }

    return {
      userResumeId,
      factIds,
      planId: planResult.planId,
      fields: planResult.results.flatMap((r) => r.fields.map((f) => ({ name: f.name, value: f.value, confidence: f.confidence }))),
      embeddingStored,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Score a resume against a job description using AI capabilities.
   * Returns AI-generated match score alongside the existing token-overlap score.
   */
  async scoreWithAi(
    resumeText: string,
    jobText: string,
    userId: string,
  ): Promise<{
    aiScore: number;
    aiConfidence: number;
    planId: string;
    fields: Array<{ name: string; value: unknown; confidence: number }>;
  }> {
    const entityId = `resume-match-${randomUUID()}`;
    const planResult = await planner.run({
      userId,
      entityId,
      entityType: 'resume',
      content: `RESUME:\n${resumeText.slice(0, 3000)}\n\nJOB:\n${jobText.slice(0, 3000)}`,
      intent: 'predict',
      plannerContext: { purpose: 'resume_job_match' },
    });

    const allFields = planResult.results.flatMap((r) => r.fields);
    const scoreField = allFields.find((f) => f.name.toLowerCase().includes('match') || f.name.toLowerCase().includes('score'));
    const aiScore = scoreField ? Number(scoreField.value) || planResult.results[0]?.confidence ?? 0 : 0;
    const aiConfidence = planResult.results[0]?.confidence ?? 0;

    return {
      aiScore: Math.max(0, Math.min(1, aiScore)),
      aiConfidence,
      planId: planResult.planId,
      fields: allFields.map((f) => ({ name: f.name, value: f.value, confidence: f.confidence })),
    };
  }
}

export const resumeIntelligenceService = new ResumeIntelligenceService();
