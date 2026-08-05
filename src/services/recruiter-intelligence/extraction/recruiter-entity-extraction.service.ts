import { randomUUID } from 'crypto';
import type { ExtractionInput, ExtractionOutput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import { normalizeLocation, normalizeOrganizationName, normalizeSkillName, normalizeText } from '../ai/utils';
import type { RecruiterMessageInput } from '../communication/communication.service';

// ─── Extracted entity types ───────────────────────────────────────────────────

export type RecruiterEntityFieldType =
  | 'recruiter_name'
  | 'recruiter_title'
  | 'recruiter_department'
  | 'recruiter_team'
  | 'recruiter_organization'
  | 'recruiter_office'
  | 'hiring_location'
  | 'technology'
  | 'skill'
  | 'hiring_domain'
  | 'employment_change'
  | 'interview_stage'
  | 'compensation_mention'
  | 'hiring_priority'
  | 'recruiter_responsibility';

export interface RecruiterEntityFact {
  factId: string;
  recruiterId: string;
  sourceMessageId: string;
  fieldType: RecruiterEntityFieldType;
  rawValue: string;
  normalizedValue: string;
  structuredValue: Record<string, unknown>;
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  evidence: EntityEvidence;
  provenance: EntityProvenance;
  observedAt: Date;
  requiresHumanReview: boolean;
}

export interface EntityEvidence {
  messageId: string;
  excerpt: string;
  startOffset?: number;
  endOffset?: number;
}

export interface EntityProvenance {
  extractor: string;
  method: 'deterministic' | 'ai_assisted' | 'hybrid';
  provider: string;
  model: string;
  templateId: string;
  templateVersion: string;
  sourceProvider: string;
  extractedAt: Date;
}

export interface EntityExtractionResult {
  extractionId: string;
  recruiterId: string;
  sourceMessageId: string;
  facts: RecruiterEntityFact[];
  overallConfidence: number;
  requiresHumanReview: boolean;
  reviewReason?: string;
  provenance: EntityProvenance;
  extractedAt: Date;
}

/**
 * RecruiterEntityExtractionService — Prompt 12 implementation.
 *
 * Extracts all recruiter intelligence fields from communications:
 *   names, titles, departments, organizations, teams, offices,
 *   hiring locations, technologies, skills, hiring domains,
 *   employment changes, interview stages, compensation mentions,
 *   hiring priorities, and recruiter responsibilities.
 *
 * Architecture:
 *   1. Deterministic extraction runs first (fast, zero-cost, high-precision signals)
 *   2. AI extraction enriches with fuzzy/contextual fields
 *   3. Facts are normalized, deduplicated, and assigned confidence bands
 *   4. Every fact carries evidence + provenance
 *   5. Low-confidence facts are flagged for human review
 */
export class RecruiterEntityExtractionService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async extractFromMessage(
    recruiterId: string,
    message: RecruiterMessageInput,
  ): Promise<EntityExtractionResult> {
    const extractionId = randomUUID();
    const content = this.buildContent(message);

    const input: ExtractionInput = {
      extractionId,
      tenantId: recruiterId,
      sourceType: 'email',
      sourceId: message.providerMessageId,
      content,
      metadata: {
        provider: message.provider,
        threadId: message.providerThreadId,
        direction: message.direction,
        sentAt: message.sentAt.toISOString(),
      },
      requestedAt: new Date(),
    };

    const variables = this.buildVariables(message, content);

    // Run deterministic extraction
    const deterministicFacts = this.extractDeterministic(recruiterId, message);

    // Run AI extraction
    let aiOutput: ExtractionOutput | null = null;
    try {
      aiOutput = await this.pipeline.extract(
        'recruiter-entity-extraction',
        input,
        variables,
      );
    } catch {
      // AI extraction failure is non-fatal; deterministic facts still returned
    }

    const aiFacts = aiOutput ? this.normalizeAiOutput(recruiterId, message, aiOutput) : [];

    // Merge: AI facts take priority when they overlap deterministic ones on the same field
    const mergedFacts = this.mergeFacts(deterministicFacts, aiFacts);

    const overallConfidence =
      mergedFacts.length > 0
        ? mergedFacts.reduce((sum, f) => sum + f.confidence, 0) / mergedFacts.length
        : 0;

    const requiresHumanReview = mergedFacts.some((f) => f.requiresHumanReview) ||
      overallConfidence < 0.55;

    return {
      extractionId,
      recruiterId,
      sourceMessageId: message.providerMessageId,
      facts: mergedFacts,
      overallConfidence: Number(overallConfidence.toFixed(4)),
      requiresHumanReview,
      reviewReason: requiresHumanReview
        ? `Overall confidence ${overallConfidence.toFixed(2)} or flagged fields require review`
        : undefined,
      provenance: {
        extractor: 'recruiter-entity-extraction-v1',
        method: aiOutput ? 'hybrid' : 'deterministic',
        provider: aiOutput?.provider ?? 'none',
        model: aiOutput?.model ?? 'none',
        templateId: 'recruiter-entity-extraction',
        templateVersion: aiOutput?.templateVersion ?? '1.0.0',
        sourceProvider: message.provider,
        extractedAt: new Date(),
      },
      extractedAt: new Date(),
    };
  }

  // ─── Deterministic extraction ───────────────────────────────────────────────

  extractDeterministic(
    recruiterId: string,
    message: RecruiterMessageInput,
  ): RecruiterEntityFact[] {
    const text = `${message.subject ?? ''}\n${message.snippet ?? ''}`;
    const facts: RecruiterEntityFact[] = [];

    const add = (
      fieldType: RecruiterEntityFieldType,
      rawValue: string,
      structuredValue: Record<string, unknown>,
      confidence: number,
      excerpt: string,
    ) => {
      const normalized = this.normalizeByFieldType(fieldType, rawValue, structuredValue);
      facts.push({
        factId: randomUUID(),
        recruiterId,
        sourceMessageId: message.providerMessageId,
        fieldType,
        rawValue,
        normalizedValue: normalized,
        structuredValue,
        confidence: Math.max(0, Math.min(1, confidence)),
        confidenceBand: this.toConfidenceBand(confidence),
        evidence: { messageId: message.providerMessageId, excerpt },
        provenance: {
          extractor: 'deterministic-entity-v1',
          method: 'deterministic',
          provider: 'none',
          model: 'regex',
          templateId: 'deterministic',
          templateVersion: '1.0.0',
          sourceProvider: message.provider,
          extractedAt: new Date(),
        },
        observedAt: message.sentAt,
        requiresHumanReview: confidence < 0.55,
      });
    };

    // Recruiter name from display name
    if (message.from.displayName) {
      add(
        'recruiter_name',
        message.from.displayName,
        { name: message.from.displayName },
        0.85,
        message.from.displayName,
      );
    }

    // Title patterns
    const titleMatch = text.match(
      /\b((?:senior|junior|lead|principal|staff|chief|head of|director of|vp of)\s+)?(?:talent\s+acquisition|technical\s+recruiter|recruiter|sourcer|hiring\s+manager|recruiting\s+coordinator|talent\s+partner|staffing\s+specialist)\b/i,
    );
    if (titleMatch?.[0]) {
      add('recruiter_title', titleMatch[0], { title: titleMatch[0].trim() }, 0.78, titleMatch[0]);
    }

    // Department patterns
    const deptMatch = text.match(
      /\b(engineering|product|design|sales|finance|legal|operations|marketing|hr|human resources|people operations)\s+(?:team|department|org|organization)\b/i,
    );
    if (deptMatch?.[0]) {
      add('recruiter_department', deptMatch[0], { department: deptMatch[0].trim() }, 0.72, deptMatch[0]);
    }

    // Team
    const teamMatch = text.match(/\b(?:team:|my team|the\s+(\w+)\s+team)\b/i);
    if (teamMatch?.[0]) {
      add('recruiter_team', teamMatch[0], { team: teamMatch[0].trim() }, 0.65, teamMatch[0]);
    }

    // Interview stage
    const interviewPatterns: Array<[string, string]> = [
      ['phone screen', 'phone_screen'],
      ['technical screen', 'technical_screen'],
      ['technical interview', 'technical_interview'],
      ['onsite', 'onsite'],
      ['on-site', 'onsite'],
      ['loop', 'interview_loop'],
      ['final round', 'final_round'],
      ['offer', 'offer'],
      ['initial call', 'initial_screen'],
      ['recruiter screen', 'recruiter_screen'],
    ];
    for (const [pattern, stage] of interviewPatterns) {
      if (new RegExp(`\\b${pattern}\\b`, 'i').test(text)) {
        add('interview_stage', pattern, { stage }, 0.82, text.slice(0, 200));
        break;
      }
    }

    // Compensation
    const compMatch = text.match(/\$\s*(\d{2,3}(?:[.,]\d{3})?)\s*[kK]?(?:\s*-\s*\$?\s*(\d{2,3}(?:[.,]\d{3})?)\s*[kK]?)?/);
    if (compMatch?.[0]) {
      add(
        'compensation_mention',
        compMatch[0],
        { mentioned: true, rawCompensation: compMatch[0] },
        0.88,
        compMatch[0],
      );
    } else if (/\b(compensation|salary|base pay|equity|bonus|stock|rsu)\b/i.test(text)) {
      add('compensation_mention', 'mentioned', { mentioned: true }, 0.72, text.slice(0, 200));
    }

    // Hiring priority signals
    if (/\b(urgent|asap|immediately|top priority|critical hire|headcount|backfill)\b/i.test(text)) {
      add('hiring_priority', 'high', { priority: 'high' }, 0.78, text.slice(0, 200));
    }

    // Technologies
    const techKeywords = [
      'typescript', 'javascript', 'python', 'java', 'golang', 'rust', 'c\\+\\+', 'c#',
      'react', 'vue', 'angular', 'node\\.js', 'node',
      'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'terraform',
      'postgresql', 'mysql', 'mongodb', 'redis', 'kafka',
      'graphql', 'rest', 'grpc',
    ];
    for (const tech of techKeywords) {
      if (new RegExp(`\\b${tech}\\b`, 'i').test(text)) {
        const matched = new RegExp(`\\b${tech}\\b`, 'i').exec(text)?.[0] ?? tech;
        add('technology', matched, { name: matched }, 0.80, matched);
      }
    }

    // Skills (non-tech)
    const skillKeywords = [
      'leadership', 'communication', 'collaboration', 'problem solving', 'system design',
      'data structures', 'algorithms', 'agile', 'scrum',
    ];
    for (const skill of skillKeywords) {
      if (new RegExp(`\\b${skill}\\b`, 'i').test(text)) {
        add('skill', skill, { name: skill }, 0.68, skill);
      }
    }

    // Hiring domain
    const domainMatch = text.match(
      /\b(infrastructure|backend|frontend|full.?stack|mobile|data|ml|machine learning|ai|security|devops|platform|cloud|sre|embedded|firmware)\b/i,
    );
    if (domainMatch?.[0]) {
      add('hiring_domain', domainMatch[0], { domain: domainMatch[0].toLowerCase() }, 0.74, domainMatch[0]);
    }

    // Hiring location
    const locationMatch = text.match(
      /\b(?:(?:remote|hybrid|on-?site)\s+)?(?:in\s+|based\s+in\s+|location[:\s]+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?)\b/,
    );
    if (locationMatch?.[1] && locationMatch[1].length > 2) {
      add('hiring_location', locationMatch[1], { location: locationMatch[1] }, 0.62, locationMatch[1]);
    }

    // Employment change signals
    if (/\b(joined|promoted|moved to|now at|recently joined|new role|just started)\b/i.test(text)) {
      add('employment_change', 'detected', { detected: true }, 0.65, text.slice(0, 200));
    }

    // Recruiter responsibility
    const respMatch = text.match(
      /\b(responsible for|covering|managing|handling|owning)\s+([\w\s]+(?:roles|positions|openings|requisitions))/i,
    );
    if (respMatch?.[0]) {
      add('recruiter_responsibility', respMatch[0], { responsibility: respMatch[0].trim() }, 0.68, respMatch[0]);
    }

    return facts;
  }

  // ─── AI output normalization ─────────────────────────────────────────────────

  private normalizeAiOutput(
    recruiterId: string,
    message: RecruiterMessageInput,
    output: ExtractionOutput,
  ): RecruiterEntityFact[] {
    return output.fields
      .filter((f) => this.isKnownFieldType(f.field))
      .map((f) => {
        const fieldType = f.field as RecruiterEntityFieldType;
        const structuredValue = this.toStructuredValue(fieldType, f.value);
        const normalized = this.normalizeByFieldType(fieldType, f.rawValue, structuredValue);

        return {
          factId: randomUUID(),
          recruiterId,
          sourceMessageId: message.providerMessageId,
          fieldType,
          rawValue: f.rawValue,
          normalizedValue: normalized,
          structuredValue,
          confidence: f.confidence,
          confidenceBand: f.confidenceBand,
          evidence: {
            messageId: message.providerMessageId,
            excerpt: f.evidence[0]?.excerpt ?? f.rawValue,
          },
          provenance: {
            extractor: 'ai-entity-extraction-v1',
            method: 'ai_assisted',
            provider: output.provider,
            model: output.model,
            templateId: output.templateId,
            templateVersion: output.templateVersion,
            sourceProvider: message.provider,
            extractedAt: output.completedAt,
          },
          observedAt: message.sentAt,
          requiresHumanReview: f.confidence < 0.55 || output.requiresHumanReview,
        };
      });
  }

  // ─── Fact merging ────────────────────────────────────────────────────────────

  private mergeFacts(
    deterministic: RecruiterEntityFact[],
    ai: RecruiterEntityFact[],
  ): RecruiterEntityFact[] {
    const aiByField = new Map<string, RecruiterEntityFact[]>();
    for (const fact of ai) {
      const bucket = aiByField.get(fact.fieldType) ?? [];
      bucket.push(fact);
      aiByField.set(fact.fieldType, bucket);
    }

    const result: RecruiterEntityFact[] = [];

    for (const det of deterministic) {
      const aiMatches = aiByField.get(det.fieldType) ?? [];
      const aiMatch = aiMatches.find(
        (a) => a.normalizedValue === det.normalizedValue || a.rawValue === det.rawValue,
      );
      if (aiMatch) {
        // Boost confidence: take max, add a small bonus for corroboration
        result.push({
          ...aiMatch,
          confidence: Math.min(1, Math.max(aiMatch.confidence, det.confidence) + 0.03),
          provenance: { ...aiMatch.provenance, method: 'hybrid' },
        });
        aiByField.set(
          det.fieldType,
          aiMatches.filter((a) => a !== aiMatch),
        );
      } else {
        result.push(det);
      }
    }

    // Add remaining AI facts not corroborated by deterministic
    for (const remaining of aiByField.values()) {
      result.push(...remaining);
    }

    return result;
  }

  // ─── Normalization helpers ───────────────────────────────────────────────────

  private normalizeByFieldType(
    fieldType: RecruiterEntityFieldType,
    rawValue: string,
    structuredValue: Record<string, unknown>,
  ): string {
    switch (fieldType) {
      case 'recruiter_name':
        return normalizeText(structuredValue['name'] ?? rawValue);
      case 'recruiter_organization':
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return normalizeOrganizationName(String(structuredValue['name'] ?? rawValue));
      case 'technology':
      case 'skill':
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return normalizeSkillName(String(structuredValue['name'] ?? rawValue));
      case 'hiring_location':
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return normalizeLocation(String(structuredValue['location'] ?? rawValue));
      default:
        return normalizeText(rawValue);
    }
  }

  private toStructuredValue(
    fieldType: RecruiterEntityFieldType,
    value: unknown,
  ): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const strVal = String(value ?? '');
    switch (fieldType) {
      case 'recruiter_name': return { name: strVal };
      case 'recruiter_title': return { title: strVal };
      case 'recruiter_organization': return { name: strVal };
      case 'recruiter_department': return { department: strVal };
      case 'recruiter_team': return { team: strVal };
      case 'technology': return { name: strVal };
      case 'skill': return { name: strVal };
      case 'hiring_location': return { location: strVal };
      case 'interview_stage': return { stage: strVal };
      default: return { value: strVal };
    }
  }

  private isKnownFieldType(field: string): boolean {
    const known: RecruiterEntityFieldType[] = [
      'recruiter_name', 'recruiter_title', 'recruiter_department', 'recruiter_team',
      'recruiter_organization', 'recruiter_office', 'hiring_location', 'technology',
      'skill', 'hiring_domain', 'employment_change', 'interview_stage',
      'compensation_mention', 'hiring_priority', 'recruiter_responsibility',
    ];
    return known.includes(field as RecruiterEntityFieldType);
  }

  private toConfidenceBand(confidence: number): RecruiterEntityFact['confidenceBand'] {
    if (confidence >= 0.90) return 'critical';
    if (confidence >= 0.72) return 'high';
    if (confidence >= 0.50) return 'medium';
    return 'low';
  }

  private buildContent(message: RecruiterMessageInput): string {
    return [
      `Subject: ${message.subject ?? ''}`,
      `From: ${message.from.displayName ?? ''} <${message.from.address}>`,
      `Direction: ${message.direction}`,
      `Body: ${message.snippet ?? ''}`,
    ].join('\n');
  }

  private buildVariables(message: RecruiterMessageInput, content: string): Record<string, string> {
    return {
      messageId: message.providerMessageId,
      direction: message.direction,
      subject: message.subject ?? '',
      fromAddress: message.from.address,
      fromName: message.from.displayName ?? '',
      sentAt: message.sentAt.toISOString(),
      content,
    };
  }
}
