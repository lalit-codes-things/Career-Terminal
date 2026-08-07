const fs = require('fs');
const path = require('path');

const files = [
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
  'src/__tests__/database-router.test.ts',
  'src/__tests__/snapshot-versioning.test.ts',
  'src/__tests__/candidate-intelligence.test.ts',
  'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
  'src/services/company/__tests__/company.service.security.test.ts',
  'src/routes/__tests__/company-intelligence.routes.test.ts',
];

for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log('SKIP (not found):', file);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if dbRouter is already properly set up
  if (content.includes('dbRouter: {\n    read: jest.fn().mockReturnValue(prisma)')) {
    console.log('SKIP (already fixed):', file);
    continue;
  }
  
  // Find jest.mock for config/database
  const mockStartRegex = /jest\.mock\(['\"].*config\/database['\"],\s*\(\)\s*=>\s*\(\{/;
  const objectStartRegex = /jest\.mock\(['\"].*config\/database['\"],\s*\(\)\s*=>\s*\{\s*const\s+prisma\s*=\s*\{/;
  
  if (objectStartRegex.test(content)) {
    // Already has const prisma pattern - just need to add dbRouter to return
    console.log('SKIP (const prisma pattern exists):', file);
    continue;
  }
  
  const mockStartMatch = content.match(mockStartRegex);
  if (!mockStartMatch) {
    console.log('SKIP (no mock found):', file);
    continue;
  }
  
  const mockStart = mockStartMatch.index + mockStartMatch[0].length;
  
  // Find the matching closing })) 
  let braceCount = 1;
  let pos = mockStart;
  while (braceCount > 0 && pos < content.length) {
    if (content[pos] === '{') braceCount++;
    else if (content[pos] === '}') braceCount--;
    pos++;
  }
  
  // Now find the closing ))
  while (pos < content.length && content.slice(pos, pos + 2) !== '))') {
    pos++;
  }
  
  const mockEnd = pos + 2;
  const mockBody = content.slice(mockStart, pos);
  
  // Check if mockBody uses `return { prisma }` pattern
  if (mockBody.includes('return { prisma }')) {
    // Simple case: return { prisma } -> return { prisma, dbRouter: {...} }
    const newMockBody = mockBody.replace(
      'return { prisma }',
      'return {\n    prisma,\n    dbRouter: {\n      read: jest.fn().mockReturnValue(prisma),\n      write: jest.fn().mockReturnValue(prisma),\n      withReplicaFallback: jest.fn(),\n      getHealth: jest.fn(),\n      disconnect: jest.fn(),\n    },\n  }'
    );
    content = content.slice(0, mockStart) + newMockBody + content.slice(pos);
    fs.writeFileSync(filePath, content);
    console.log('FIXED (return pattern):', file);
  } else if (mockBody.includes('return { prisma,')) {
    // Pattern: return { prisma, ... } - add dbRouter before closing }
    const returnMatch = mockBody.match(/return\s*\{\s*prisma,/);
    if (returnMatch) {
      const returnStart = mockBody.indexOf('return');
      const afterPrismaComma = returnStart + returnMatch[0].length;
      const newMockBody = mockBody.slice(0, afterPrismaComma) + '\n    dbRouter: {\n      read: jest.fn().mockReturnValue(prisma),\n      write: jest.fn().mockReturnValue(prisma),\n      withReplicaFallback: jest.fn(),\n      getHealth: jest.fn(),\n      disconnect: jest.fn(),\n    },' + mockBody.slice(afterPrismaComma);
      content = content.slice(0, mockStart) + newMockBody + content.slice(pos);
      fs.writeFileSync(filePath, content);
      console.log('FIXED (return with props):', file);
    } else {
      console.log('SKIP (unmatched return pattern):', file);
    }
  } else if (mockBody.includes('({')) {
    // Pattern: jest.mock(..., () => ({ prisma: {...} }))
    // Need to convert to function body with const prisma variable
    const objectStart = mockStart + mockBody.indexOf('({');
    const afterOpenBrace = objectStart + 2;
    
    // Find the closing } of the object
    let objBraceCount = 1;
    let objPos = afterOpenBrace;
    while (objBraceCount > 0 && objPos < content.length) {
      if (content[objPos] === '{') objBraceCount++;
      else if (content[objPos] === '}') objBraceCount--;
      objPos++;
    }
    
    const objCloseIdx = objPos - 1;
    const objContent = content.slice(afterOpenBrace, objCloseIdx);
    
    // Convert: () => ({ prisma: {...}, }) -> () => { const prisma = {...}; return { prisma, dbRouter: {...} }; }
    const newMockBody = ` {\n  const prisma = {${objContent.replace(/^\s*prisma:\s*/, '')}\n  };\n  return {\n    prisma,\n    dbRouter: {\n      read: jest.fn().mockReturnValue(prisma),\n      write: jest.fn().mockReturnValue(prisma),\n      withReplicaFallback: jest.fn(),\n      getHealth: jest.fn(),\n      disconnect: jest.fn(),\n    },\n  };`;
    
    content = content.slice(0, mockStart - 1) + newMockBody + content.slice(objCloseIdx + 1);
    fs.writeFileSync(filePath, content);
    console.log('FIXED (object pattern):', file);
  } else {
    console.log('SKIP (unknown pattern):', file);
  }
}
