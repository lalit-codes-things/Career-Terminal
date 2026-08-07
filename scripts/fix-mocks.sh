#!/bin/bash
set -e

DBROUTER="  dbRouter: {\n    read: jest.fn().mockReturnValue(prisma),\n    write: jest.fn().mockReturnValue(prisma),\n    withReplicaFallback: jest.fn(),\n    getHealth: jest.fn(),\n    disconnect: jest.fn(),\n  },"

for file in \
  "src/__tests__/email-worker.test.ts" \
  "src/__tests__/user-action-log.test.ts" \
  "src/__tests__/fact-correction.service.test.ts" \
  "src/__tests__/event.service.test.ts" \
  "src/__tests__/company.service.test.ts" \
  "src/__tests__/resume-security.test.ts" \
  "src/__tests__/outcome.service.test.ts" \
  "src/__tests__/placement.service.test.ts" \
  "src/__tests__/action.service.test.ts" \
  "src/__tests__/fact.service.test.ts" \
  "src/__tests__/checkpoint-resumability.test.ts" \
  "src/__tests__/resume-versioning.service.test.ts" \
  "src/__tests__/gmail-sync.test.ts" \
  "src/__tests__/zzz-dbg.test.ts" \
  "src/__tests__/application-merge.service.test.ts" \
  "src/__tests__/outcome-tracking.test.ts" \
  "src/__tests__/security-hardening.test.ts" \
  "src/__tests__/opportunity.service.test.ts" \
  "src/__tests__/gmail-oauth.test.ts" \
  "src/__tests__/snapshot.service.test.ts" \
  "src/__tests__/status-engine.service.test.ts" \
  "src/__tests__/recruiter.service.test.ts" \
  "src/__tests__/durable-checkpoint.test.ts" \
  "src/__tests__/canonical-intelligence.test.ts" \
  "src/__tests__/application-tracking.test.ts" \
  "src/__tests__/checkpoint.service.test.ts" \
  "src/__tests__/dashboard.service.test.ts" \
  "src/__tests__/application-timeline.service.test.ts" \
  "src/__tests__/provenance-pipeline.test.ts" \
  "src/__tests__/job-analytics.service.test.ts" \
  "src/__tests__/snapshot-versioning.test.ts" \
  "src/__tests__/candidate-intelligence.test.ts" \
  "src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts" \
  "src/services/company/__tests__/company.service.security.test.ts" \
  "src/routes/__tests__/company-intelligence.routes.test.ts"
do
  if [ ! -f "$file" ]; then
    echo "SKIP (not found): $file"
    continue
  fi
  
  if grep -q "dbRouter:" "$file"; then
    echo "SKIP (already has dbRouter): $file"
    continue
  fi
  
  if grep -q "jest.mock.*config/database.*=> (" "$file"; then
    # Pattern: jest.mock(..., () => ({ ... }));
    # Convert to function body
    sed -i "s|jest.mock('.*config/database', () => ({|jest.mock('&', () => {\n  const prisma = ({|" "$file"
    # Add dbRouter before the closing })); 
    # This is tricky with sed, so let's use a different approach
    echo "ARROW OBJ: $file"
  elif grep -q "jest.mock.*config/database.*=> {" "$file"; then
    # Pattern: jest.mock(..., () => { const prisma = { ... }; return { prisma }; });
    # Add dbRouter to the return
    sed -i "s|return { prisma };|return {\n    prisma,\n$DBROUTER\n  };|" "$file"
    echo "FIXED (func body): $file"
  else
    echo "NO PATTERN: $file"
  fi
done
