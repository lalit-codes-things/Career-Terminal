import { randomUUID } from 'crypto';
import type { RecruiterIdentityInput, RecruiterIdentityProfile } from './identity.types';
import {
  buildFingerprints,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeSocial,
} from './normalization';

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export class RecruiterIdentityService {
  createIdentity(input: RecruiterIdentityInput, now = new Date()): RecruiterIdentityProfile {
    const signals = input.signals ?? [];
    const emails = uniq(
      signals.filter((s) => s.kind === 'email').map((s) => normalizeEmail(s.value)),
    );
    const phones = uniq(
      signals.filter((s) => s.kind === 'phone').map((s) => normalizePhone(s.value)),
    );
    const socialProfiles = uniq(
      signals.filter((s) => s.kind === 'social').map((s) => normalizeSocial(s.value)),
    );
    const employers = uniq(
      signals.filter((s) => s.kind === 'employer').map((s) => normalizeName(s.value)),
    );
    const atsIdentifiers = uniq(signals.filter((s) => s.kind === 'ats').map((s) => s.value.trim()));
    const fingerprints = buildFingerprints(input.displayName, signals);
    const confidence = this.scoreConfidence(signals, input.provenance.evidence.length);
    const qualityScore = this.scoreQuality(
      { emails, phones, socialProfiles, employers, atsIdentifiers },
      confidence,
    );
    const id = randomUUID();

    return {
      id,
      canonicalId: id,
      lifecycleState: input.lifecycleState ?? 'canonical',
      displayName: input.displayName.trim(),
      normalizedName: normalizeName(input.displayName),
      emails,
      phones,
      socialProfiles,
      employers,
      atsIdentifiers,
      fingerprints,
      confidence,
      qualityScore,
      verificationStatus: input.verificationStatus ?? 'PENDING',
      metadata: input.metadata ?? {},
      provenance: input.provenance,
      createdAt: now,
      updatedAt: now,
    };
  }

  mergeIdentities(
    canonical: RecruiterIdentityProfile,
    duplicate: RecruiterIdentityProfile,
    now = new Date(),
  ): {
    canonical: RecruiterIdentityProfile;
    duplicate: RecruiterIdentityProfile;
  } {
    const mergedSignals = {
      emails: uniq([...canonical.emails, ...duplicate.emails]),
      phones: uniq([...canonical.phones, ...duplicate.phones]),
      socialProfiles: uniq([...canonical.socialProfiles, ...duplicate.socialProfiles]),
      employers: uniq([...canonical.employers, ...duplicate.employers]),
      atsIdentifiers: uniq([...canonical.atsIdentifiers, ...duplicate.atsIdentifiers]),
    };
    const fingerprints = uniq([...canonical.fingerprints, ...duplicate.fingerprints]);
    const confidence = Math.max(canonical.confidence, duplicate.confidence);

    return {
      canonical: {
        ...canonical,
        ...mergedSignals,
        fingerprints,
        confidence,
        qualityScore: this.scoreQuality(mergedSignals, confidence),
        metadata: {
          ...canonical.metadata,
          mergedIdentityIds: uniq([
            ...((canonical.metadata.mergedIdentityIds as string[] | undefined) ?? []),
            duplicate.id,
          ]),
        },
        updatedAt: now,
      },
      duplicate: {
        ...duplicate,
        canonicalId: canonical.canonicalId,
        lifecycleState: 'merged',
        updatedAt: now,
      },
    };
  }

  retireIdentity(
    identity: RecruiterIdentityProfile,
    reason: string,
    now = new Date(),
  ): RecruiterIdentityProfile {
    return {
      ...identity,
      lifecycleState: 'retired',
      metadata: { ...identity.metadata, retiredReason: reason },
      updatedAt: now,
    };
  }

  verifyIdentity(
    identity: RecruiterIdentityProfile,
    status = 'VERIFIED' as const,
    now = new Date(),
  ): RecruiterIdentityProfile {
    return {
      ...identity,
      verificationStatus: status,
      confidence: Math.max(identity.confidence, 0.95),
      updatedAt: now,
    };
  }

  private scoreConfidence(
    signals: RecruiterIdentityInput['signals'] = [],
    evidenceCount: number,
  ): number {
    const base = signals.length === 0 ? 0.45 : 0.55;
    const weighted = signals.reduce((sum, signal) => sum + (signal.confidence ?? 0.65), base);
    return Math.min(
      0.99,
      Number((weighted / (signals.length + 1) + evidenceCount * 0.03).toFixed(4)),
    );
  }

  private scoreQuality(
    signals: {
      emails: string[];
      phones: string[];
      socialProfiles: string[];
      employers: string[];
      atsIdentifiers: string[];
    },
    confidence: number,
  ): number {
    const coverage = [
      signals.emails,
      signals.phones,
      signals.socialProfiles,
      signals.employers,
      signals.atsIdentifiers,
    ].filter((items) => items.length > 0).length;
    return Math.min(1, Number((confidence * 0.65 + (coverage / 5) * 0.35).toFixed(4)));
  }
}
