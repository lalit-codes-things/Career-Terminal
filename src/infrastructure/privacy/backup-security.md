# Backup Security Policy — ApplyWise

**Epic 0.7, Phase 23**  
**Owner:** Platform Engineering  
**Review cycle:** Annually or after any incident involving backup data

---

## 1. Database Backup (PostgreSQL)

### Encryption
- All pg_dump backups must be encrypted with AES-256 before writing to storage.
- Use `pg_dump | openssl enc -aes-256-cbc -salt -pbkdf2 -out backup.dump.enc` (minimum).
- Preferred: use cloud-provider managed encryption at rest (SSE) in addition to application-level encryption.

### Access Control
- Backup files must be stored in a dedicated, access-controlled location (S3 bucket or NFS mount).
- Access limited to the DBA role and the backup service account only.
- No developer or application process should have direct read access to backup files.

### Retention
- Automated daily backups: retain 30 days.
- Weekly backups: retain 3 months.
- Monthly backups: retain 1 year (regulatory requirement).
- Purge scripts must run automatically; manual retention is insufficient.

### Contents warning
- Database backups contain all encrypted OAuth tokens, PII fields (email addresses, recruiter emails, candidate emails), and application history.
- They are subject to the same handling requirements as production data.

---

## 2. Redis Backup / AOF Persistence

### RDB snapshots and AOF files
- Redis RDB snapshots and AOF persistence files contain refresh tokens (opaque, 256-bit entropy) and OAuth CSRF state.
- These files must be owner-only permissions: `chmod 600` on the Redis data directory.
- Do NOT allow the Redis process to run as root.

### Offsite backup encryption
- Before transferring RDB or AOF files offsite (e.g., to S3 or backup server), encrypt them:
  - Use a **separate** key from the application `ENCRYPTION_KEY`.
  - Store the backup encryption key in the secret manager (not alongside the backup files).
- Redis backups do NOT need to be retained long-term; refresh tokens expire in 7 days.
- Recommendation: retain Redis backups for 24 hours only (for disaster recovery of very recent data).

### In-memory data
- Refresh tokens stored in Redis have a 7-day TTL.
- OAuth CSRF state tokens have a 15-minute TTL.
- Loss of Redis data results in user sessions being terminated, not data loss of records.

---

## 3. S3/MinIO Backup Security

### Versioning
- Enable S3 object versioning on the resume storage bucket.
- Versioning protects against accidental deletion and provides a recovery window.

### Cross-region replication
- If multi-region is required, use S3 Cross-Region Replication (CRR) with SSE-KMS.
- The KMS key used for replication encryption must be a separate key per region.
- CRR copies must use the same private bucket ACL — no public access.

### Access control
- Resume bucket must have `BlockPublicAcls: true`, `BlockPublicPolicy: true`.
- Access via presigned URLs only (1-hour TTL).
- No static public URLs permitted.
- IAM policy must limit GetObject to the resume-worker service account only.

---

## 4. Secret Backup Considerations

**Critical rule: NEVER back up the application `ENCRYPTION_KEY` (or any `ENCRYPTION_KEY_VN`) alongside the encrypted data it protects.**

If both the backup and the key are in the same location, a single backup breach yields decrypted data.

### Separation requirements
- Store `ENCRYPTION_KEY` in a secret manager (Vault / AWS Secrets Manager / GCP Secret Manager).
- Database backups must NEVER be stored in the same bucket or system as the encryption keys.
- If using S3 for backups: store keys in AWS Secrets Manager, not in S3.
- If using Vault: the Vault transit seal must be in a physically separate failure domain from the database.

### Key backup
- The secret manager itself handles key backup and high availability.
- Do NOT manually copy `ENCRYPTION_KEY` values to spreadsheets, wikis, email, or Slack.
- Emergency key recovery: use the secret manager's MFA-protected recovery mechanism.

---

## 5. Restore Testing Requirement

- Backups must be tested by performing a full restore to a non-production environment **at minimum quarterly**.
- The restore test must verify:
  1. PostgreSQL schema and data integrity (`pg_restore` completes without errors).
  2. All encrypted fields can be decrypted with the current key version (run validation query).
  3. Application startup passes `validateEncryptionConfig()` after restore.
  4. A sample of user records are readable and complete.

- Test results must be documented in the incident/ops log.
- Untested backups should be treated as no backup.

---

## 6. Backup Encryption Key Management

The backup encryption key is **separate** from the application `ENCRYPTION_KEY`:

| Key | Purpose | Storage |
|-----|---------|---------|
| `ENCRYPTION_KEY` | Encrypts OAuth tokens in PostgreSQL at runtime | Secret manager (Vault / AWS SM) |
| `BACKUP_ENCRYPTION_KEY` | Encrypts database dump files before offsite transfer | Secret manager (separate path) |

### Rotation of backup key
- Rotate `BACKUP_ENCRYPTION_KEY` annually or on team member departure.
- When rotating: re-encrypt the most recent backup with the new key before deleting the old key.
- Old backups encrypted with the old key: retain them accessible under the old key for the retention period, then destroy both backup and old key together.

### Emergency procedures
- If `ENCRYPTION_KEY` is suspected compromised: see `SECURITY.md` — Emergency Rotation Procedure.
- Immediately rotate the application key; the re-encryption worker will migrate active tokens.
- Notify affected users if there is evidence of token exfiltration.
