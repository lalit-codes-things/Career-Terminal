# AI Architecture

## Goals

- Keep AI provider-independent.
- Support future multi-model and multi-provider orchestration.
- Maintain confidence, provenance, and reviewability for all extracted data.

## Layers

1. LLM Gateway
   - Provides a stable interface for prompt execution.
   - Supports provider selection and fallback strategies.

2. Extraction Layer
   - Converts raw text into structured facts with confidence and evidence attachments.

3. Embedding Layer
   - Produces vectors for semantic retrieval and GraphRAG readiness.

4. Inference Layer
   - Classifies, ranks, and enriches recruiter signals.

## Contracts

- LLM Gateway interface remains provider-agnostic.
- Embedding service is separate from prompt execution.
- Extraction results return confidence bands and evidence references.

## Governance

- Track cost and latency hooks for each provider call.
- Support human review flagging for low-confidence extraction.
- Preserve provenance for all AI-generated facts.
