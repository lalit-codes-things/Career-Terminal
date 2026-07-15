/**
 * Job Email Classifier — hybrid rules-first classifier with optional ML fallback.
 */
import type { JobEmailMlModel } from './ml-model.interface';
import {
  ruleBasedJobEmailClassifier,
  RuleBasedJobEmailClassifier,
} from './rule-based-classifier';
import type {
  ClassifiableEmail,
  JobEmailClassification,
} from '../models/job-intelligence.types';

export interface JobEmailClassifierOptions {
  /** Optional ML model invoked when rule confidence is below the threshold. */
  mlModel?: JobEmailMlModel;
  /** Minimum rule confidence before attempting ML fallback (default: 0.65). */
  mlConfidenceThreshold?: number;
  /** Inject a custom rule engine (useful for testing). */
  ruleClassifier?: RuleBasedJobEmailClassifier;
}

const DEFAULT_ML_THRESHOLD = 0.65;

export class JobEmailClassifier {
  private readonly mlModel?: JobEmailMlModel;
  private readonly mlConfidenceThreshold: number;
  private readonly ruleClassifier: RuleBasedJobEmailClassifier;

  constructor(options: JobEmailClassifierOptions = {}) {
    this.mlModel = options.mlModel;
    this.mlConfidenceThreshold =
      options.mlConfidenceThreshold ?? DEFAULT_ML_THRESHOLD;
    this.ruleClassifier =
      options.ruleClassifier ?? ruleBasedJobEmailClassifier;
  }

  /** Synchronous rules-only classification. */
  classify(email: ClassifiableEmail): JobEmailClassification {
    const { result, detectedCompany, detectedRole } =
      this.ruleClassifier.classifyWithEntities(email);

    return {
      emailId: email.emailId,
      category: result.category,
      confidence: result.confidence,
      detectedCompany,
      detectedRole,
    };
  }

  /**
   * Hybrid classification: rules first, ML fallback when confidence is low.
   * When no ML model is configured, behaves like classify().
   */
  async classifyAsync(
    email: ClassifiableEmail
  ): Promise<JobEmailClassification> {
    const ruleResult = this.classify(email);

    if (
      !this.mlModel ||
      ruleResult.confidence >= this.mlConfidenceThreshold
    ) {
      return ruleResult;
    }

    const mlResult = await this.mlModel.classify(email);
    if (!mlResult) {
      return ruleResult;
    }

    return mlResult.confidence > ruleResult.confidence ? mlResult : ruleResult;
  }
}

export const jobEmailClassifier = new JobEmailClassifier();
