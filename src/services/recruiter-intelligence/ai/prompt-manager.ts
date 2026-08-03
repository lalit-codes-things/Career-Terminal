import type { PromptTemplate, RenderedPrompt } from './types';

/**
 * PromptManager owns all prompt templates and renders them with context.
 * Templates are versioned so extractions are fully reproducible.
 * No provider-specific logic lives here.
 */
export class PromptManager {
  private readonly templates = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): void {
    const key = this.key(template.templateId, template.version);
    this.templates.set(key, template);
    // Also store as the latest version for this templateId
    this.templates.set(template.templateId, template);
  }

  get(templateId: string, version?: string): PromptTemplate {
    const key = version ? this.key(templateId, version) : templateId;
    const template = this.templates.get(key);
    if (!template) {
      throw new Error(`Prompt template not found: ${templateId}${version ? `@${version}` : ''}`);
    }
    return template;
  }

  render(templateId: string, variables: Record<string, string>, version?: string): RenderedPrompt {
    const template = this.get(templateId, version);
    const userPrompt = this.interpolate(template.userPromptTemplate, variables);
    return {
      templateId: template.templateId,
      templateVersion: template.version,
      systemPrompt: template.systemPrompt,
      userPrompt,
      estimatedInputTokens: this.estimateTokens(template.systemPrompt + userPrompt),
    };
  }

  list(): PromptTemplate[] {
    return [...this.templates.values()].filter((t) => !t.templateId.includes('@'));
  }

  private interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
  }

  /**
   * Rough token estimate: ~4 chars per token (conservative).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private key(templateId: string, version: string): string {
    return `${templateId}@${version}`;
  }
}

// ─── Built-in Templates ───────────────────────────────────────────────────────

export function buildDefaultTemplates(): PromptTemplate[] {
  const now = new Date();
  return [
    {
      templateId: 'recruiter-entity-extraction',
      name: 'Recruiter Entity Extraction',
      version: '1.0.0',
      tier: 'balanced',
      systemPrompt: [
        'You are an expert recruiter intelligence system.',
        'Extract structured facts about recruiters from the provided communication.',
        'Return ONLY valid JSON matching the schema. Do not hallucinate facts.',
        'Every fact must have evidence pointing to the exact excerpt that supports it.',
        'If you are not confident about a fact, assign a lower confidence score.',
        'confidence is a float from 0.0 (no confidence) to 1.0 (certain).',
      ].join('\n'),
      userPromptTemplate: [
        'Extract recruiter intelligence from the following communication.',
        '',
        'MESSAGE ID: {{messageId}}',
        'DIRECTION: {{direction}}',
        'SUBJECT: {{subject}}',
        'FROM: {{fromAddress}} ({{fromName}})',
        'SENT AT: {{sentAt}}',
        '',
        'CONTENT:',
        '{{content}}',
        '',
        'Return JSON with this exact structure:',
        '{',
        '  "fields": [',
        '    {',
        '      "field": "<field_name>",',
        '      "value": <extracted_value>,',
        '      "rawValue": "<exact text from message>",',
        '      "confidence": <0.0-1.0>,',
        '      "evidence": [{"excerpt": "<exact quote>", "confidence": <0.0-1.0>}]',
        '    }',
        '  ]',
        '}',
        '',
        'Valid field names: recruiter_name, recruiter_title, recruiter_department,',
        'recruiter_team, recruiter_organization, recruiter_office, hiring_location,',
        'technology, skill, hiring_domain, employment_change, interview_stage,',
        'compensation_mention, hiring_priority, recruiter_responsibility.',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              required: ['field', 'value', 'rawValue', 'confidence', 'evidence'],
            },
          },
        },
      },
      maxTokens: 2048,
      temperature: 0.1,
      createdAt: now,
    },
    {
      templateId: 'recruiter-reasoning-enrichment',
      name: 'Recruiter Reasoning & Enrichment',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are an expert recruiter intelligence analyst.',
        'Your task is to INFER recruiter attributes that are not explicitly stated.',
        'Reason step-by-step. Every inference must be backed by explicit evidence.',
        'Return ONLY valid JSON. Do not invent facts.',
        'All inferences must include: reasoning, confidence, supportingEvidence.',
      ].join('\n'),
      userPromptTemplate: [
        'Analyze the following recruiter profile and infer hidden attributes.',
        '',
        'RECRUITER ID: {{recruiterId}}',
        'KNOWN FACTS:',
        '{{knownFacts}}',
        '',
        'COMMUNICATION HISTORY (last {{messageCount}} messages):',
        '{{communicationSummary}}',
        '',
        'Infer the following attributes:',
        '- seniority: junior/mid/senior/lead/executive',
        '- specialization: engineering/product/design/sales/finance/operations/general',
        '- hiringFocus: [list of role types]',
        '- technicalDomains: [list of technology domains]',
        '- businessDomains: [list of business domains]',
        '- geographicResponsibility: [list of regions/locations]',
        '- decisionAuthority: initiator/influencer/decision_maker/unknown',
        '- likelyHiringManagerRelationships: [inferred relationships]',
        '- candidateOwnership: [candidate segments this recruiter likely owns]',
        '- communicationIntent: informational/screening/scheduling/negotiating/closing',
        '- urgency: low/medium/high/critical',
        '- followUpRequirements: [list of required follow-up actions]',
        '',
        'Return JSON with this structure:',
        '{',
        '  "inferences": [',
        '    {',
        '      "attribute": "<attribute_name>",',
        '      "value": <inferred_value>,',
        '      "reasoning": "<step-by-step reasoning>",',
        '      "confidence": <0.0-1.0>,',
        '      "supportingEvidence": ["<evidence 1>", "<evidence 2>"]',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['inferences'],
        properties: {
          inferences: {
            type: 'array',
            items: {
              type: 'object',
              required: ['attribute', 'value', 'reasoning', 'confidence', 'supportingEvidence'],
            },
          },
        },
      },
      maxTokens: 4096,
      temperature: 0.2,
      createdAt: now,
    },
    {
      templateId: 'recruiter-intelligence-profile',
      name: 'Recruiter Intelligence Profile Generation',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter intelligence profiler.',
        'Generate a comprehensive recruiter intelligence profile from structured facts.',
        'Every statement in the profile must be directly traceable to a specific fact.',
        'Do not add information not present in the facts.',
        'Be concise, specific, and evidence-driven.',
      ].join('\n'),
      userPromptTemplate: [
        'Generate a recruiter intelligence profile from the following structured facts.',
        '',
        'RECRUITER ID: {{recruiterId}}',
        '',
        'STRUCTURED FACTS:',
        '{{structuredFacts}}',
        '',
        'INFERENCES:',
        '{{inferences}}',
        '',
        'Generate:',
        '1. summary: 2-3 sentence executive summary',
        '2. hiringFocus: what roles/functions this recruiter focuses on',
        '3. technicalFocus: technical domains and stacks',
        '4. industryFocus: industry verticals',
        '5. organizationContext: team, department, company context',
        '6. communicationStyle: how this recruiter communicates',
        '7. recruitingStyle: their recruiting approach',
        '8. hiringVelocitySignals: urgency and pace indicators',
        '9. relationshipStrength: strength of candidate relationship signals',
        '10. candidateFitSignals: what kind of candidates they seek',
        '',
        'Return JSON:',
        '{',
        '  "summary": "...",',
        '  "hiringFocus": [...],',
        '  "technicalFocus": [...],',
        '  "industryFocus": [...],',
        '  "organizationContext": {...},',
        '  "communicationStyle": "...",',
        '  "recruitingStyle": "...",',
        '  "hiringVelocitySignals": {...},',
        '  "relationshipStrength": {...},',
        '  "candidateFitSignals": [...]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: [
          'summary',
          'hiringFocus',
          'technicalFocus',
          'industryFocus',
          'organizationContext',
          'communicationStyle',
          'recruitingStyle',
          'hiringVelocitySignals',
          'relationshipStrength',
          'candidateFitSignals',
        ],
      },
      maxTokens: 3000,
      temperature: 0.15,
      createdAt: now,
    },
  ];
}
