/**
 * ML model interface — plug in a trained classifier later without changing callers.
 */
import type { ClassifiableEmail, JobEmailClassification } from '../models/job-intelligence.types';

export interface JobEmailMlModel {
  /** Returns a classification when the model has a prediction; null to defer to rules. */
  classify(email: ClassifiableEmail): Promise<JobEmailClassification | null>;
}
