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
    'src/__tests__/outcome-tracking.test.ts',
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
    'src/__tests__/snapshot-versioning.test.ts',
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
    
    # Pattern: jest.mock('../config/database', () => ({ ... }));
    # We need to find the matching })); for the => ({ ... })
    # Use a simple state machine to find the arrow function object literal
    
    mock_start = content.find("jest.mock('../config/database', () => ({")
    if mock_start == -1:
        mock_start = content.find('jest.mock("../config/database", () => ({')
    
    if mock_start == -1:
        print(f'NO MOCK: {file}')
        continue
    
    # Find the opening ({ after =>
    arrow_start = content.find('=> ({', mock_start)
    if arrow_start == -1:
        print(f'NO ARROW OBJ: {file}')
        continue
    
    obj_start = arrow_start + 5  # position after '=> ({'
    
    # Find matching closing }))
    depth = 1
    pos = obj_start
    while depth > 0 and pos < len(content):
        if content[pos] == '{':
            depth += 1
        elif content[pos] == '}':
            depth -= 1
        pos += 1
    
    obj_end = pos - 1  # position of the closing } of the object
    
    # Now find the closing ))
    while pos < len(content) and content[pos:pos+2] != '))':
        pos += 1
    
    full_end = pos + 2  # position after ))]
    
    obj_content = content[obj_start:obj_end]
    
    # Check if obj_content contains 'prisma:'
    if 'prisma:' not in obj_content:
        print(f'NO PRISMA PROP: {file}')
        continue
    
    # Replace 'prisma: {...}' with 'const prisma = {...};' inside the object content
    # We need to extract the prisma object value
    
    # Find 'prisma:' and its matching braces
    prisma_label_start = obj_content.find('prisma:')
    prisma_value_start = obj_content.find('{', prisma_label_start)
    
    # Find the closing } of the prisma value
    depth = 1
    ppos = prisma_value_start + 1
    while depth > 0 and ppos < len(obj_content):
        if obj_content[ppos] == '{':
            depth += 1
        elif obj_content[ppos] == '}':
            depth -= 1
        ppos += 1
    
    prisma_value_end = ppos  # position after the closing }
    
    prisma_value = obj_content[prisma_value_start:prisma_value_end]
    
    # Build new object content: everything before prisma + const prisma = ... + everything after prisma value
    before_prisma = obj_content[:prisma_label_start]
    after_prisma = obj_content[prisma_value_end:]
    
    new_obj_content = before_prisma + f'const prisma = {prisma_value};\n  return {{\n    prisma,\n' + DBROUTER_MOCK + '\n  };\n' + after_prisma
    
    # Build new mock: jest.mock(..., () => { ...new_obj_content... });
    new_mock = content[:obj_start - 3] + '{\n' + new_obj_content + content[obj_end + 1:]
    
    with open(file, 'w') as f:
        f.write(new_mock)
    
    print(f'FIXED: {file}')
