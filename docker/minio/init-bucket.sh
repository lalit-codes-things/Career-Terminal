
set -e

ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
BUCKET="${MINIO_BUCKET:-career-terminal-resumes}"
ALIAS="local"

echo "[minio-init] Waiting for MinIO at ${ENDPOINT}..."

# Poll until MinIO health endpoint returns 200
until curl -sf "${ENDPOINT}/minio/health/live" > /dev/null 2>&1; do
  echo "[minio-init] MinIO not ready yet — retrying in 2s..."
  sleep 2
done

echo "[minio-init] MinIO is ready."

# Configure mc alias
mc alias set "${ALIAS}" "${ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"

# Create bucket (idempotent — safe to re-run)
if mc ls "${ALIAS}/${BUCKET}" > /dev/null 2>&1; then
  echo "[minio-init] Bucket '${BUCKET}' already exists — skipping creation."
else
  mc mb "${ALIAS}/${BUCKET}"
  echo "[minio-init] Bucket '${BUCKET}' created."
fi

# Enforce private access (no public reads or writes)
mc anonymous set none "${ALIAS}/${BUCKET}"
echo "[minio-init] Bucket '${BUCKET}' access policy set to private."

echo "[minio-init] Done."
