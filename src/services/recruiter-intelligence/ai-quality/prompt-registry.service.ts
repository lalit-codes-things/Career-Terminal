import type { PromptVersion, PromptRegistryEntry, PromptExperiment, PromptExperimentStatus } from '../../../domain/recruiter-intelligence/ai-quality/contracts';

export class PromptRegistryService {
  private readonly registry = new Map<string, PromptRegistryEntry>();
  private readonly experiments = new Map<string, PromptExperiment>();

  register(entry: PromptRegistryEntry): void {
    this.registry.set(entry.templateId, entry);
  }

  get(templateId: string): PromptRegistryEntry | undefined {
    return this.registry.get(templateId);
  }

  getAll(): PromptRegistryEntry[] {
    return [...this.registry.values()];
  }

  updateVersion(templateId: string, version: PromptVersion): PromptRegistryEntry | null {
    const entry = this.registry.get(templateId);
    if (!entry) return null;

    entry.versions.push(version);
    entry.activeVersion = version.version;
    entry.updatedAt = new Date();

    return entry;
  }

  createExperiment(experiment: PromptExperiment): PromptExperiment {
    this.experiments.set(experiment.experimentId, experiment);
    return experiment;
  }

  getExperiment(experimentId: string): PromptExperiment | undefined {
    return this.experiments.get(experimentId);
  }

  getAllExperiments(): PromptExperiment[] {
    return [...this.experiments.values()];
  }

  updateExperimentStatus(experimentId: string, status: PromptExperimentStatus): PromptExperiment | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return null;
    experiment.status = status;
    if (status === 'completed' || status === 'archived') {
      experiment.completedAt = new Date();
    }
    return experiment;
  }

  getExperimentsByTemplate(templateId: string): PromptExperiment[] {
    return [...this.experiments.values()].filter((e) => e.templateId === templateId);
  }

  delete(templateId: string): boolean {
    return this.registry.delete(templateId);
  }
}