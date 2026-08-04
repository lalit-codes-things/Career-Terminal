# ADR-004: AI Quality, Evaluation & Observability

## Status
Accepted

## Context

Epic 6 requires production-grade AI quality infrastructure. Previous batches implemented basic AI extraction and reasoning but lacked systematic evaluation, observability, and continuous improvement capabilities.

## Decision

We will implement a comprehensive AI Quality infrastructure that provides:
1. **Evaluation Framework** — Offline, online, regression, and benchmark evaluation phases
2. **Prompt Versioning & Registry** — Versioned prompt templates with experiment support
3. **Model Registry** — Provider-independent model registration and comparison
4. **Hallucination Detection** — Automated evidence-based hallucination detection
5. **Confidence Calibration** — ECE, Brier score, and reliability diagram computation
6. **Tracing** — OpenTelemetry-compatible span tracing with inference logging
7. **Feedback Pipeline** — Structured feedback collection and rating
8. **Benchmark Suite** — Regression testing and provider/model/prompt comparison

## Consequences

- All AI outputs are systematically evaluated and measurable
- Prompt experiments enable A/B testing of prompt variations
- Model comparison enables provider-agnostic model selection
- Hallucination detection catches fabricated facts before storage
- Confidence calibration ensures prediction reliability matches confidence scores
- Tracing enables end-to-end latency and cost analysis
- Feedback pipeline enables continuous improvement from human reviewers
- Benchmark suites enable regression testing against known datasets

## Implementation

- `EvaluationFrameworkService` — Multi-phase evaluation with quality metrics
- `PromptRegistryService` — Versioned prompt management with experiment support
- `ModelRegistryService` — Provider-independent model registration and comparison
- `HallucinationDetector` — Evidence-based hallucination detection
- `ConfidenceCalibrator` — Calibration error, ECE, and Brier score computation
- `TracingService` — Span-based tracing with inference logging
- `FeedbackPipelineService` — Structured feedback collection and analysis
- `BenchmarkSuiteService` — Regression testing and comparison frameworks

## Trade-offs

- In-memory storage for evaluations (production would use time-series databases)
- Calibration requires sufficient prediction volume for reliable binning
- Tracing adds overhead to each AI call (mitigated by sampling in production)