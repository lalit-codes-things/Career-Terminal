# Epic 6 — Integration Documentation

## Cross-Epic Integration

### Overview

The Cross-Epic Intelligence Integration layer enables bidirectional intelligence sharing between all six intelligence modules:

- User Intelligence
- Opportunity Intelligence
- Application Intelligence
- Resume Intelligence
- Company Intelligence
- Recruiter Intelligence

### Integration Patterns

#### Publish-Subscribe

Intelligence modules publish structured intelligence to the integration layer. Other modules consume this intelligence via queries.

```typescript
// Publish intelligence from Recruiter to Company
await integration.publish(
  'recruiter-intelligence',
  recruiterId,
  'company-intelligence',
  companyId,
  'identity',
  { recruiterName, recruiterTitle, organization },
  0.85,
  evidence,
  provenance,
);

// Consume intelligence in Company module
const result = await integration.query({
  sourceEpic: 'company-intelligence',
  sourceEntityId: companyId,
  targetEpics: ['recruiter-intelligence'],
  domains: ['identity', 'behavior'],
  minConfidence: 0.5,
  requireEvidence: true,
  maxResults: 10,
});
```

#### Bidirectional Linking

For symmetric relationships, use bidirectional publishing:

```typescript
const { linkA, linkB } = await integration.publishBidirectional(
  'resume-intelligence',
  resumeId,
  'recruiter-intelligence',
  recruiterId,
  'skills',
  resumeSkills,
  recruiterSkills,
  0.80,
  evidence,
  provenance,
);
```

### Cross-Domain Reasoning

The Intelligence Broker enables multi-hop reasoning across domains:

1. **Direct Links** — Immediate connections between modules
2. **GraphRAG Enrichment** — Traverse knowledge graph for indirect connections
3. **Semantic Enrichment** — Match similar intelligence across domains
4. **Memory Enrichment** — Retrieve historical context
5. **Timeline Enrichment** — Retrieve temporal context

### Domain Mappings

| Source Domain | Target Domain | Integration Type |
|--------------|--------------|-----------------|
| Resume ↔ Recruiter | Identity, Skills | Bidirectional |
| Recruiter ↔ Company | Identity, Behavior, Decision | Bidirectional |
| Company ↔ Opportunity | Company, Market, Technical | Bidirectional |
| Opportunity ↔ Application | Opportunity, Application, Decision | Bidirectional |
| Recruiter ↔ Application | Behavior, Decision, Communication | Bidirectional |
| Resume ↔ Skills | Skills, Technical | Bidirectional |
| Application ↔ Communication | Communication, Behavior | Bidirectional |

## AI Quality Integration

### Evaluation Pipeline

```
AI Output → Output Validation → Hallucination Detection → Confidence Calibration → Quality Metrics → Feedback Loop
```

### Provider Comparison

```typescript
const comparison = await evaluationFramework.compareProviders(
  ['openai', 'anthropic', 'vertex'],
  ['gpt-4', 'claude-3', 'gemini-pro'],
  'recruiter-entity-extraction',
  results,
);
```

### Model Comparison

```typescript
const comparison = await evaluationFramework.compareModels(
  ['model-v1', 'model-v2', 'model-v3'],
  'recruiter-entity-extraction',
  results,
);
```

### Prompt Comparison

```typescript
const comparison = await evaluationFramework.comparePrompts(
  'recruiter-entity-extraction',
  ['1.0.0', '1.1.0', '2.0.0'],
  results,
);
```

## Observability Integration

### OpenTelemetry

All AI operations emit OpenTelemetry spans:

- `extraction.pipeline.extract` — AI extraction latency
- `cross-epic.publish` — Cross-epic link creation latency
- `cross-epic.query` — Cross-epic query latency
- `hallucination.detect` — Hallucination detection latency
- `confidence.calibrate` — Calibration computation latency

### Metrics

- `ai_extraction_count` — Total extractions by template, provider, model
- `ai_extraction_latency_ms` — Extraction latency distribution
- `ai_extraction_cost_usd` — Cost per extraction
- `ai_extraction_confidence` — Confidence distribution
- `ai_hallucination_rate` — Hallucination rate by template
- `cross_epic_link_count` — Active cross-epic links
- `cross_epic_link_confidence` — Link confidence distribution
- `cross_epic_message_count` — Messages processed

### Tracing

All AI calls include trace context:

- `extractionId` — Unique extraction identifier
- `templateId` — Prompt template used
- `provider` — AI provider used
- `model` — Model used
- `inputTokens` — Input token count
- `outputTokens` — Output token count
- `latencyMs` — Call latency
- `confidence` — Output confidence
- `requiresReview` — Whether human review is needed