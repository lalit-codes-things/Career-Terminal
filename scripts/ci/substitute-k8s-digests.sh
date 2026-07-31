#!/usr/bin/env bash
# substitute-k8s-digests.sh
#
# Replaces mutable image tags in k8s manifests with immutable digest
# references (image@sha256:<digest>) at deploy time.
#
# Usage:
#   ./scripts/ci/pin-k8s-images.sh <api-digest> <worker-digest> <migrator-digest>
#   ./scripts/ci/pin-k8s-images.sh --output-dir <dir> <api-digest> <worker-digest> <migrator-digest>
#
# The digests are the raw sha256 hex (without the "sha256:" prefix) produced
# by `docker buildx imagetools inspect` or the registry's manifest API.
#
# This script does NOT contact a registry — it only performs text substitution
# on the manifest files. The caller is responsible for providing valid digests
# from the actual published images.
#
# Environment variables (optional overrides):
#   IMAGE_REGISTRY   — defaults to ghcr.io
#   IMAGE_REPOSITORY — defaults to the GitHub repo name (auto-detected from .git)
set -euo pipefail

K8S_DIR="$(cd "$(dirname "$0")/../.." && pwd)/k8s"
OUTPUT_DIR="$K8S_DIR"

# ── Parse arguments ───────────────────────────────────────────────────────────

DIGESTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--output-dir <dir>] <api-digest> <worker-digest> <migrator-digest>"
      echo "  Digests are raw sha256 hex without the 'sha256:' prefix."
      echo "  Example: $0 abc123 def456 789abc"
      exit 0
      ;;
    *)
      DIGESTS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#DIGESTS[@]} -lt 1 ]]; then
  echo "ERROR: At least one image digest argument is required."
  echo "Usage: $0 <api-digest> [worker-digest] [migrator-digest]"
  exit 1
fi

API_DIGEST="${DIGESTS[0]:-}"
WORKER_DIGEST="${DIGESTS[1]:-}"
MIGRATOR_DIGEST="${DIGESTS[2]:-}"

# ── Resolve registry & repository ───────────────────────────────────────────────

REGISTRY="${IMAGE_REGISTRY:-}"
REPO="${IMAGE_REPOSITORY:-}"

if [[ -z "$REGISTRY" ]]; then
  # Try to derive from .git/config remote.origin.url
  if [[ -f "$(dirname "$K8S_DIR")/.git/config" ]]; then
    REMOTE=$(git -C "$(dirname "$K8S_DIR")" config --get remote.origin.url 2>/dev/null || true)
    if [[ -n "$REMOTE" ]]; then
      # github.com/owner/repo.git → ghcr.io/owner/repo
      REGISTRY="ghcr.io"
      REPO=$(echo "$REMOTE" | sed 's|git@github.com:||;s|https://github.com/||;s|\.git$||')
    fi
  fi
  [[ -z "$REGISTRY" ]] && REGISTRY="ghcr.io"
fi

[[ -z "$REPO" ]] && REPO="career-terminal/backend"

FULL_IMAGE="${REGISTRY}/${REPO}"

substitute_digest() {
  local file="$1"
  local old_image="$2"
  local digest="$3"
  local tmp
  tmp=$(mktemp)
  sed "s|image: ${old_image}|image: ${FULL_IMAGE}@sha256:${digest}|g" "$file" > "$tmp"
  mv "$tmp" "$file"
  echo "  Pinned ${old_image} → ${FULL_IMAGE}@sha256:${digest:0:12}... in $(basename "$file")"
}

echo "Pinning k8s image references to immutable digests..."
echo "  Registry:       $REGISTRY"
echo "  Repository:     $REPO"
echo "  Output dir:     $OUTPUT_DIR"
echo ""

# ── Pin each known manifest ───────────────────────────────────────────────────

pin_manifest() {
  local manifest="$1"
  local filename="$2"
  local target="$3"
  local digest="$4"
  local filepath="${OUTPUT_DIR}/${filename}"

  if [[ -f "$filepath" ]] && [[ -n "$digest" ]]; then
    substitute_digest "$filepath" "$target" "$digest"
  fi
}

pin_manifest "$OUTPUT_DIR/deployment.yaml" "deployment.yaml" "career-terminal-api:0.1.0" "$API_DIGEST"
pin_manifest "$OUTPUT_DIR/worker-deployment.yaml" "worker-deployment.yaml" "career-terminal-api:0.1.0" "$WORKER_DIGEST"
pin_manifest "$OUTPUT_DIR/migration-job.yaml" "migration-job.yaml" "career-terminal-migrator:0.1.0" "$MIGRATOR_DIGEST"

# If only one digest was provided, apply it to all manifests (same image)
if [[ ${#DIGESTS[@]} -eq 1 ]]; then
  for manifest in deployment.yaml worker-deployment.yaml; do
    filepath="${OUTPUT_DIR}/${manifest}"
    if [[ -f "$filepath" ]] && grep -q "career-terminal-api:0.1.0" "$filepath"; then
      substitute_digest "$filepath" "career-terminal-api:0.1.0" "$API_DIGEST"
    fi
  done
fi

echo ""
echo "Done. Verify with: npm run ci:validate-k8s-images"
