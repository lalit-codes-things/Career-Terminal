#!/usr/bin/env node
/**
 * Validate Kubernetes image references for supply-chain safety.
 *
 * Rules:
 *   1. Mutable tags (latest, stable, production, or any semver tag without a
 *      digest) are flagged. Production manifests should use immutable digests.
 *   2. Well-known mutable pseudo-tags are hard failures.
 *   3. Images with @sha256:<digest> are always accepted.
 *
 * Usage:
 *   node scripts/ci/validate-k8s-images.js          # fail on mutable tags
 *   node scripts/ci/validate-k8s-images.js --warn   # warn only (CI advisory)
 *
 * This script does NOT require a registry connection — it only inspects the
 * image reference strings in the manifests. Digest pinning is performed at
 * deploy time via scripts/ci/pin-k8s-images.sh with the actual digest from
 * the container registry.
 */
const fs = require('fs');
const path = require('path');

const k8sDir = path.join(process.cwd(), 'k8s');

// Tags that are always mutable and never acceptable.
const HARD_MUTABLE_TAGS = new Set(['latest', 'stable', 'production']);

// Semver-like tags (e.g. 0.1.0, 1.2.3, v1.0.0) are mutable references.
const SEMVER_TAG_PATTERN = /^v?\d+\.\d+\.\d+/;

const imagePattern = /^\s*image:\s*([^\s#]+).*$/gm;

const args = process.argv.slice(2);
const warnOnly = args.includes('--warn');

const failures = [];
const warnings = [];

for (const entry of fs.readdirSync(k8sDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.yaml$/i.test(entry.name) || entry.name.includes('template')) {
    continue;
  }

  const filePath = path.join(k8sDir, entry.name);
  const content = fs.readFileSync(filePath, 'utf8');
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const image = match[1].replace(/^["']|["']$/g, '');
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    const hasDigest = image.includes('@sha256:');
    const tag = hasDigest ? null : image.split('/').pop().split(':')[1];

    if (hasDigest) {
      continue;
    }

    if (!tag) {
      failures.push(`${path.relative(process.cwd(), filePath)}:${line}: image "${image}" has no tag or digest`);
      continue;
    }

    if (HARD_MUTABLE_TAGS.has(tag)) {
      failures.push(`${path.relative(process.cwd(), filePath)}:${line}: mutable tag "${tag}" is forbidden`);
      continue;
    }

    if (SEMVER_TAG_PATTERN.test(tag)) {
      warnings.push(
        `${path.relative(process.cwd(), filePath)}:${line}: image "${image}" uses a mutable semver tag "${tag}". ` +
          'Pin to an immutable digest (sha256) at deploy time via scripts/ci/pin-k8s-images.sh.',
      );
    }
  }
}

if (warnings.length > 0) {
  console.warn('Warnings (mutable tags — digest pinning recommended):\n');
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (failures.length > 0 || (!warnOnly && warnings.length > 0)) {
  console.error('\nKubernetes image references must use immutable digests or non-mutable tags:');
  for (const failure of failures) {
    console.error(`- FAIL: ${failure}`);
  }
  for (const warning of warnings) {
    console.error(`- WARN: ${warning}`);
  }
  console.error(
    '\nTo pin to a digest at deploy time, run:\n' +
      '  scripts/ci/pin-k8s-images.sh <api-image-digest> <worker-image-digest> <migrator-image-digest>\n' +
      'Or manually replace the image tag with: registry/path/image@sha256:<actual-digest>',
  );
  process.exit(1);
}

console.log('Kubernetes image references validated (digest pinning ready).');
