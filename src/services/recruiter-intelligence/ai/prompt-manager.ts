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
        '    {"field": "<insight_title>", "value": "<insight_text>", "confidence": <0.0-1.0>, "evidence": [{"excerpt": "<source>"}]}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter behavioral intelligence analyst.',
        'Infer behavioral patterns from structured recruiter facts and reasoning outputs.',
        'Return ONLY valid JSON. Every inference must cite supporting evidence.',
        'Behavioral dimensions: communicationStyle, activityPatterns, schedulingBehavior,',
        'recruiterPreferences, responsivenessTrends.',
        'confidence is a float 0.0–1.0.',
      ].join('\n'),
      userPromptTemplate: [
        'Infer behavioral dimensions for recruiter {{recruiterId}}.',
        '',
        'KNOWN SIGNALS:',
        '{{signals}}',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {',
        '      "field": "<dimension>",',
        '      "value": <inferred_value>,',
        '      "confidence": <0.0-1.0>,',
        '      "evidence": [{"excerpt": "<supporting_signal>"}]',
        '    }',
        '  ]',
        '}',
        '',
        'Valid dimensions: communicationStyle, activityPatterns, schedulingBehavior, recruiterPreferences, responsivenessTrends.',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.15,
      createdAt: now,
    },
    // ─── Batch 4: Prompt 17 — Reputation & Trust ────────────────────────────────
    {
      templateId: 'recruiter-reputation-trust',
      name: 'Recruiter Reputation & Trust Engine',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter trust and reputation scoring engine.',
        'Estimate trustworthiness from multiple independent signals.',
        'Never rely on a single signal — always aggregate multiple evidence sources.',
        'Every score must be explainable. Return ONLY valid JSON.',
        'Scores are floats 0.0–1.0. Higher = more trustworthy.',
      ].join('\n'),
      userPromptTemplate: [
        'Estimate trust signals for recruiter {{recruiterId}}.',
        '',
        'AVAILABLE SIGNALS:',
        '{{signals}}',
        '',
        'Score these trust dimensions (0.0–1.0):',
        '- response_reliability: how reliably does this recruiter respond?',
        '- communication_professionalism: how professional is their communication?',
        '- ghosting_probability: (inverted) lower ghosting = higher score',
        '- candidate_experience: quality of candidate experience signals',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {"field": "<dimension>", "value": <score>, "confidence": <0.0-1.0>, "evidence": [{"excerpt": "<reason>"}]}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.10,
      createdAt: now,
    },
    // ─── Batch 4: Prompt 18 — Specialization Intelligence ───────────────────────
    {
      templateId: 'recruiter-specialization-intelligence',
      name: 'Recruiter Specialization Intelligence',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter specialization intelligence system.',
        'Infer recruiter expertise from observed hiring signals.',
        'Return ONLY valid JSON. Do not invent facts.',
        'Every inference must cite the signals that support it.',
      ].join('\n'),
      userPromptTemplate: [
        'Infer specialization for recruiter {{recruiterId}}.',
        '',
        'OBSERVED SIGNALS:',
        '{{signals}}',
        '',
        'Infer:',
        '- hiringDomains: array of primary hiring domains (engineering/product/design/sales/etc)',
        '- technologyStacks: array of {stackName, components, confidence}',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {"field": "hiringDomains", "value": [...], "confidence": <0.0-1.0>, "evidence": [{"excerpt": "..."}]},',
        '    {"field": "technologyStacks", "value": [...], "confidence": <0.0-1.0>, "evidence": [{"excerpt": "..."}]}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.10,
      createdAt: now,
    },
    // ─── Batch 4: Prompt 19 — Decision Intelligence ──────────────────────────────
    {
      templateId: 'recruiter-decision-intelligence',
      name: 'Recruiter Decision Intelligence',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter decision intelligence predictor.',
        'Predict decision probabilities from structured recruiter signals.',
        'All predictions must be evidence-backed and explainable.',
        'Return ONLY valid JSON. Probabilities are floats 0.0–1.0.',
        'Do not fabricate signals — only use provided evidence.',
      ].join('\n'),
      userPromptTemplate: [
        'Predict decision probabilities for recruiter {{recruiterId}}.',
        '',
        'SIGNALS:',
        '{{signals}}',
        '',
        'Predict (0.0–1.0):',
        '- interview_likelihood: probability an interview will be scheduled',
        '- response_likelihood: probability recruiter will respond',
        '- offer_probability: probability of receiving an offer',
        '- engagement_probability: probability of sustained engagement',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {"field": "<dimension>", "value": <probability>, "confidence": <0.0-1.0>, "evidence": [{"excerpt": "<reason>"}]}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.10,
      createdAt: now,
    },
    // ─── Batch 4: Prompt 20 — Insights Engine ────────────────────────────────────
    {
      templateId: 'recruiter-insights-engine',
      name: 'Recruiter AI Insights Engine',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are a recruiter insights AI that generates actionable intelligence.',
        'Synthesize multiple layers of recruiter intelligence into clear, actionable insights.',
        'Never hallucinate facts. Every insight must cite a specific evidence source.',
        'Return ONLY valid JSON.',
        'Insights must be concise (1-2 sentences) and directly actionable.',
      ].join('\n'),
      userPromptTemplate: [
        'Generate actionable insights for recruiter {{recruiterId}}.',
        '',
        'AGGREGATED INTELLIGENCE:',
        '{{intelligence}}',
        '',
        'Generate key insights about:',
        '- Most important action the candidate should take',
        '- Key risk or opportunity to be aware of',
        '- Communication or timing recommendation',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {"field": "<insight_title>", "value": "<insight_text>", "confidence": <0.0-1.0>, "evidence": [{"excerpt": "<source>"}]}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 3000,
      temperature: 0.20,
      createdAt: now,
    },
    // ─── Batch 6: Prompt 26 — AI Recruiter Copilot ───────────────────────────────
    {
      templateId: 'recruiter-copilot',
      name: 'Recruiter Copilot Conversation Engine',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are an intelligent Recruiter Copilot for Career Terminal.',
        'Answer user queries using ONLY the provided context (GraphRAG, Memory, Facts).',
        'Never hallucinate or fabricate information. Return ONLY valid JSON.',
        'Provide actionable, goal-oriented assistance with structured citations.',
      ].join('\n'),
      userPromptTemplate: [
        'Respond to the user query regarding recruiter {{recruiterId}}.',
        '',
        'CONTEXT:',
        '{{context}}',
        '',
        'QUERY:',
        '{{query}}',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {"field": "intent", "value": "<detected_intent>", "confidence": <0.0-1.0>, "evidence": []},',
        '    {"field": "answerText", "value": "<response>", "confidence": <0.0-1.0>, "evidence": [{"excerpt": "<citation>"}]},',
        '    {"field": "suggestedFollowUps", "value": ["<question1>", "<question2>"], "confidence": <0.0-1.0>, "evidence": []}',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.20,
      createdAt: now,
    },
    // ─── Batch 6: Prompt 27 — Autonomous Recruiter Intelligence ────────────────
    {
      templateId: 'autonomous-recruiter-intelligence',
      name: 'Autonomous Intelligence Pipeline',
      version: '1.0.0',
      tier: 'powerful',
      systemPrompt: [
        'You are the autonomous intelligence engine monitoring recruiters.',
        'Analyze recent events (messages, timeline changes) and detect proactive risks or opportunities.',
        'Never recommend autonomous external actions (e.g., "send an email automatically").',
        'Return ONLY valid JSON.',
      ].join('\n'),
      userPromptTemplate: [
        'Analyze recent events for recruiter {{recruiterId}}.',
        '',
        'RECENT EVENTS:',
        '{{recentEvents}}',
        '',
        'Identify alerts (ghosting risks, opportunity improvements, etc.).',
        '',
        'Return JSON:',
        '{',
        '  "fields": [',
        '    {',
        '      "field": "alerts",',
        '      "value": [',
        '        {',
        '          "category": "<category>",',
        '          "title": "<title>",',
        '          "description": "<description>",',
        '          "severity": "<low|medium|high|critical>",',
        '          "suggestedActions": [{"type": "<type>", "description": "<desc>", "priority": "<low|normal|high>"}]',
        '        }',
        '      ],',
        '      "confidence": <0.0-1.0>,',
        '      "evidence": [{"excerpt": "<citation>"}]',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
      outputSchema: {
        type: 'object',
        required: ['fields'],
        properties: { fields: { type: 'array' } },
      },
      maxTokens: 2048,
      temperature: 0.15,
      createdAt: now,
    },
  ];
}
