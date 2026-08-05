import { randomUUID } from 'crypto';
import type { ConfidenceCalibrationResult } from '../../../domain/recruiter-intelligence/ai-quality/contracts';

export class ConfidenceCalibrator {
  calibrate(
    modelId: string,
    templateId: string,
    predictions: Array<{ confidence: number; correct: boolean }>,
  ): ConfidenceCalibrationResult {
    const calibrationId = randomUUID();
    const totalPredictions = predictions.length;
    const correctPredictions = predictions.filter((p) => p.correct).length;

    const bins = [
      { min: 0, max: 0.1, label: '0-0.1', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.1, max: 0.2, label: '0.1-0.2', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.2, max: 0.3, label: '0.2-0.3', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.3, max: 0.4, label: '0.3-0.4', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.4, max: 0.5, label: '0.4-0.5', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.5, max: 0.6, label: '0.5-0.6', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.6, max: 0.7, label: '0.6-0.7', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.7, max: 0.8, label: '0.7-0.8', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.8, max: 0.9, label: '0.8-0.9', counts: [] as number[], accuracies: [] as number[] },
      { min: 0.9, max: 1.0, label: '0.9-1.0', counts: [] as number[], accuracies: [] as number[] },
    ];

    for (const pred of predictions) {
      const bin = bins.find((b) => pred.confidence >= b.min && pred.confidence < b.max);
      if (bin) {
        bin.counts.push(pred.confidence);
        bin.accuracies.push(pred.correct ? 1 : 0);
      }
    }

    const reliabilityDiagram = bins.map((b) => ({
      bin: b.label,
      accuracy: b.accuracies.length > 0
        ? b.accuracies.reduce((s, a) => s + a, 0) / b.accuracies.length
        : 0,
      confidence: b.counts.length > 0
        ? b.counts.reduce((s, c) => s + c, 0) / b.counts.length
        : 0,
      count: b.counts.length,
    }));

    const calibrationError = this.computeCalibrationError(reliabilityDiagram);
    const ece = this.computeECE(reliabilityDiagram);
    const brierScore = this.computeBrierScore(predictions);

    return {
      calibrationId,
      modelId,
      templateId,
      totalPredictions,
      correctPredictions,
      calibrationError,
      ece,
      brierScore,
      reliabilityDiagram,
      completedAt: new Date(),
    };
  }

  private computeCalibrationError(diagram: Array<{ accuracy: number; confidence: number; count: number }>): number {
    if (diagram.length === 0) return 0;
    const totalError = diagram.reduce((s, d) => {
      const weight = d.count > 0 ? d.count : 1;
      return s + Math.abs(d.accuracy - d.confidence) * weight;
    }, 0);
    const totalCount = diagram.reduce((s, d) => s + d.count, 0);
    return totalCount > 0 ? totalError / totalCount : 0;
  }

  private computeECE(diagram: Array<{ accuracy: number; confidence: number; count: number }>): number {
    const totalCount = diagram.reduce((s, d) => s + d.count, 0);
    if (totalCount === 0) return 0;
    return diagram.reduce((s, d) => {
      const weight = d.count / totalCount;
      return s + Math.abs(d.accuracy - d.confidence) * weight;
    }, 0);
  }

  private computeBrierScore(predictions: Array<{ confidence: number; correct: boolean }>): number {
    if (predictions.length === 0) return 0;
    return predictions.reduce((s, p) => {
      const outcome = p.correct ? 1 : 0;
      return s + Math.pow(p.confidence - outcome, 2);
    }, 0) / predictions.length;
  }
}