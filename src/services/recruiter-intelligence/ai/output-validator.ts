import type { ValidationError, ValidationResult, ValidationWarning } from './types';

/**
 * OutputValidator validates raw JSON strings returned by the AI model
 * against the expected schema for a given template.
 *
 * Keeps the AI pipeline honest — if the model returns hallucinated or
 * malformed output it is caught here before it reaches fact storage.
 */
export class OutputValidator {
  validateJson(rawText: string): { parsed: unknown; valid: boolean; error?: string } {
    const trimmed = rawText.trim();
    // Strip markdown code fences if model wrapped the JSON
    const cleaned = trimmed.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      const parsed: unknown = JSON.parse(cleaned);
      return { parsed, valid: true };
    } catch (err) {
      return {
        parsed: null,
        valid: false,
        error: err instanceof Error ? err.message : 'JSON parse error',
      };
    }
  }

  validateExtractionOutput(parsed: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!parsed || typeof parsed !== 'object') {
      errors.push({ field: 'root', message: 'Output must be a JSON object', severity: 'critical' });
      return { valid: false, errors, warnings };
    }

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj['fields'])) {
      errors.push({ field: 'fields', message: 'fields must be an array', severity: 'critical' });
      return { valid: false, errors, warnings };
    }

    for (let i = 0; i < (obj['fields'] as unknown[]).length; i++) {
      const field = (obj['fields'] as unknown[])[i];
      if (!field || typeof field !== 'object') {
        errors.push({
          field: `fields[${i}]`,
          message: 'Field entry must be an object',
          severity: 'error',
        });
        continue;
      }
      const f = field as Record<string, unknown>;

      if (typeof f['field'] !== 'string' || !f['field']) {
        errors.push({ field: `fields[${i}].field`, message: 'field name is required', severity: 'error' });
      }
      if (f['value'] === undefined) {
        errors.push({ field: `fields[${i}].value`, message: 'value is required', severity: 'error' });
      }
      if (typeof f['confidence'] !== 'number') {
        errors.push({ field: `fields[${i}].confidence`, message: 'confidence must be a number', severity: 'error' });
      } else if ((f['confidence']) < 0 || (f['confidence']) > 1) {
        warnings.push({ field: `fields[${i}].confidence`, message: 'confidence should be between 0.0 and 1.0' });
      }
      if (!Array.isArray(f['evidence'])) {
        warnings.push({ field: `fields[${i}].evidence`, message: 'evidence should be an array' });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  validateReasoningOutput(parsed: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!parsed || typeof parsed !== 'object') {
      errors.push({ field: 'root', message: 'Output must be a JSON object', severity: 'critical' });
      return { valid: false, errors, warnings };
    }

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj['inferences'])) {
      errors.push({ field: 'inferences', message: 'inferences must be an array', severity: 'critical' });
      return { valid: false, errors, warnings };
    }

    for (let i = 0; i < (obj['inferences'] as unknown[]).length; i++) {
      const inference = (obj['inferences'] as unknown[])[i];
      if (!inference || typeof inference !== 'object') {
        errors.push({ field: `inferences[${i}]`, message: 'Inference must be an object', severity: 'error' });
        continue;
      }
      const inf = inference as Record<string, unknown>;

      if (typeof inf['attribute'] !== 'string' || !inf['attribute']) {
        errors.push({ field: `inferences[${i}].attribute`, message: 'attribute is required', severity: 'error' });
      }
      if (inf['value'] === undefined) {
        errors.push({ field: `inferences[${i}].value`, message: 'value is required', severity: 'error' });
      }
      if (typeof inf['reasoning'] !== 'string' || !inf['reasoning']) {
        errors.push({ field: `inferences[${i}].reasoning`, message: 'reasoning is required for explainability', severity: 'error' });
      }
      if (typeof inf['confidence'] !== 'number') {
        errors.push({ field: `inferences[${i}].confidence`, message: 'confidence must be a number', severity: 'error' });
      }
      if (!Array.isArray(inf['supportingEvidence'])) {
        warnings.push({ field: `inferences[${i}].supportingEvidence`, message: 'supportingEvidence should be an array' });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  validateProfileOutput(parsed: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!parsed || typeof parsed !== 'object') {
      errors.push({ field: 'root', message: 'Profile output must be a JSON object', severity: 'critical' });
      return { valid: false, errors, warnings };
    }

    const obj = parsed as Record<string, unknown>;
    const requiredFields = [
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
    ];

    for (const field of requiredFields) {
      if (obj[field] === undefined || obj[field] === null) {
        warnings.push({ field, message: `Profile field "${field}" is missing` });
      }
    }

    if (typeof obj['summary'] !== 'string' || !obj['summary']) {
      errors.push({ field: 'summary', message: 'summary must be a non-empty string', severity: 'error' });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Clamps all confidence scores in extracted fields to [0, 1].
   */
  normalizeConfidence<T extends { confidence?: unknown }>(item: T): T {
    if (typeof item.confidence !== 'number') return item;
    return { ...item, confidence: Math.max(0, Math.min(1, item.confidence)) };
  }
}
