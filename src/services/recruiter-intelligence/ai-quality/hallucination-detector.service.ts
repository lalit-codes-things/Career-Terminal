import { randomUUID } from 'crypto';
import type { HallucinationDetectionResult, ExtractionOutput } from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class HallucinationDetector {
  detect(output: ExtractionOutput, evidence: string[]): HallucinationDetectionResult {
    const hallucinatedFields: string[] = [];
    const evidenceSupport: Record<string, number> = {};

    for (const field of output.fields) {
      const fieldEvidence = field.evidence ?? [];
      const hasEvidence = fieldEvidence.length > 0;
      const evidenceConfidence = hasEvidence
        ? fieldEvidence.reduce((s, e) => s + e.confidence, 0) / fieldEvidence.length
        : 0;

      evidenceSupport[field.field] = evidenceConfidence;

      if (!hasEvidence && field.confidence > 0.7) {
        hallucinatedFields.push(field.field);
      }

      if (hasEvidence && evidenceConfidence < 0.3 && field.confidence > 0.6) {
        hallucinatedFields.push(field.field);
      }

      const valueStr = JSON.stringify(field.value);
      if (valueStr.length > 500 && evidenceConfidence < 0.4) {
        hallucinatedFields.push(field.field);
      }
    }

    const hasHallucination = hallucinatedFields.length > 0;
    const overallEvidenceSupport = output.fields.length > 0
      ? output.fields.reduce((s, f) => s + (evidenceSupport[f.field] ?? 0), 0) / output.fields.length
      : 0;

    return {
      detectionId: randomUUID(),
      extractionId: output.extractionId,
      hasHallucination,
      hallucinatedFields,
      evidenceSupport,
      confidence: hasHallucination ? Math.max(0, 1 - overallEvidenceSupport) : overallEvidenceSupport,
      explanation: hasHallucination
        ? `Detected ${hallucinatedFields.length} field(s) with insufficient evidence support: ${hallucinatedFields.join(', ')}`
        : 'No hallucinations detected. All fields have adequate evidence support.',
      completedAt: new Date(),
    };
  }

  detectBatch(outputs: ExtractionOutput[], evidence: string[][]): HallucinationDetectionResult[] {
    return outputs.map((output, index) => this.detect(output, evidence[index] ?? []));
  }

  computeHallucinationRate(detections: HallucinationDetectionResult[]): number {
    if (detections.length === 0) return 0;
    const hallucinatedCount = detections.filter((d) => d.hasHallucination).length;
    return hallucinatedCount / detections.length;
  }
}