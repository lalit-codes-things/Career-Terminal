#!/usr/bin/env python3
import re
import os

files = [
    'src/__tests__/email-worker.test.ts',
    'src/__tests__/user-action-log.test.ts',
    'src/__tests__/fact-correction.service.test.ts',
    'src/__tests__/event.service.test.ts',
    'src/__tests__/company.service.test.ts',
    'src/__tests__/resume-security.test.ts',
    'src/__tests__/outcome.service.test.ts',
    'src/__tests__/placement.service.test.ts',
    'src/__tests__/action.service.test.ts',
    'src/__tests__/fact.service.test.ts',
    'src/__tests__/checkpoint-resumability.test.ts',
    'src/__tests__/resume-versioning.service.test.ts',
    'src/__tests__/gmail-sync.test.ts',
    'src/__tests__/zzz-dbg.test.ts',
    'src/__tests__/application-merge.service.test.ts',
    'src/__tests__/outcome-events.test.ts',
    'src/__tests__/security-hardening.test.ts',
    'src/__tests__/opportunity.service.test.ts',
    'src/__tests__/gmail-oauth.test.ts',
    'src/__tests__/snapshot.service.test.ts',
    'src/__tests__/status-engine.service.test.ts',
    'src/__tests__/recruiter.service.test.ts',
    'src/__tests__/durable-checkpoint.test.ts',
    'src/__tests__/canonical-intelligence.test.ts',
    'src/__tests__/application-tracking.test.ts',
    'src/__tests__/checkpoint.service.test.ts',
    'src/__tests__/dashboard.service.test.ts',
    'src/__tests__/application-timeline.service.test.ts',
    'src/__tests__/provenance-pipeline.test.ts',
    'src/__tests__/job-analytics.service.test.ts',
    'src/__tests__/temporal-snapshots.test.ts',
    'src/__tests__/candidate-intelligence.test.ts',
    'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
    'src/services/company/__tests__/company.service.security.test.ts',
    'src/routes/__tests__/company-intelligence.routes.test.ts',
]

DBROUTER_MOCK = """\
  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },"""

for file in files:
    if not os.path.exists(file):
        print(f'MISSING: {file}')
        continue
    
    with open(file, 'r') as f:
        content = f.read()
    
    if 'dbRouter:' in content:
        print(f'SKIP (already has dbRouter): {file}')
        continue
    
    # Pattern 1: jest.mock(..., () => ({ ... }));  - arrow function with object literal
    pattern1 = r"jest\.mock\(['\"][^'\"]*config/database['\"],\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\s*\)\s*\);"
    
    def replace_pattern1(match):
        obj_content = match.group(1)
        prisma_match = re.search(r'prisma:\s*\{([\s\S]*)\}(?=,\s*\w+\s*:|,\s*\n\s*\})', obj_content)
        if not prisma_match:
            return match.group(0)
        
        prisma_body = prisma_match.group(1)
        new_mock = "jest.mock('../config/database', () => {\n"
        new_mock += "  const prisma = {" + prisma_body + "};\n"
        new_mock += "  return {\n"
        new_mock += "    prisma,\n"
        new_mock += DBROUTER_MOCK + "\n"
        new_mock += "  };\n"
        new_mock += "});"
        return new_mock
    
    new_content = re.sub(pattern1, replace_pattern1, content)
    
    if new_content != content:
        with open(file, 'w') as f:
            f.write(new_content)
        print(f'FIXED (pattern 1): {file}')
        continue
    
    # Pattern 2: jest.mock(..., () => { const prisma = { ... }; return { prisma }; });
    pattern2 = r"jest\.mock\(['\"][^'\"]*config/database['\"],\s*\(\)\s*=>\s*\{[\s\S]*?return\s*\{\s*prisma\s*\}[\s\S]*?\}\s*\);"
    
    def replace_pattern2(match):
        old = match.group(0)
        new = old.replace(
            'return { prisma }',
            'return { prisma, dbRouter: {\n      read: jest.fn().mockReturnValue(prisma),\n      write: jest.fn().mockReturnValue(prisma),\n      withReplicaFallback: jest.fn(),\n      getHealth: jest.fn(),\n      disconnect: jest.fn(),\n    } }'
        )
        return new
    
    new_content = re.sub(pattern2, replace_pattern2, content)
    
    if new_content != content:
        with open(file, 'w') as f:
            f.write(new_content)
        print(f'FIXED (pattern 2): {file}')
        continue
    
    print(f'NO PATTERN: {file}')
