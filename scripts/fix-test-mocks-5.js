const fs = require('fs');
const path = require('path');

const files = [
  'src/__tests__/application-merge.service.test.ts',
  'src/__tests__/user-action-log.test.ts',
  'src/__tests__/snapshot-versioning.test.ts',
  'src/__tests__/status-engine.service.test.ts',
  'src/__tests__/snapshot.service.test.ts',
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
  
  // Find all occurrences of dbRouter inside jest.mock and fix them
  // The pattern we're looking for is dbRouter being inside the prisma object
  
  const lines = content.split('\n');
  let inMock = false;
  let mockStart = -1;
  let prismaBraceDepth = 0;
  let dbRouterLines = [];
  let resultLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes("jest.mock('../config/database'") || line.includes('jest.mock("../config/database"')) {
      inMock = true;
      mockStart = i;
      resultLines.push(line);
      continue;
    }
    
    if (inMock) {
      if (line.includes('dbRouter:')) {
        // Collect dbRouter lines until we find the closing },,
        let dbRouterBlock = line;
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('},,')) {
          dbRouterBlock += '\n' + lines[j];
          j++;
        }
        if (j < lines.length) {
          dbRouterBlock += '\n' + lines[j];
          // Check if next line is the closing of prisma
          const nextLine = lines[j + 1];
          if (nextLine && nextLine.trim() === '},') {
            // dbRouter is at the end of prisma object - move it outside
            // Remove the dbRouter block from current position
            // We'll add it after the prisma closing brace
            resultLines.push('  },');
            resultLines.push('  ' + dbRouterBlock.replace(/^  /, '').replace(/,$/, ''));
            i = j + 1;
            inMock = false;
            continue;
          } else {
            // dbRouter is in the middle of prisma - need more complex handling
            // For now, just track and fix later
            dbRouterLines.push({ start: i, end: j, block: dbRouterBlock });
          }
        }
      }
    }
    
    resultLines.push(line);
  }
  
  // If we collected dbRouter blocks in the middle, handle them
  if (dbRouterLines.length > 0) {
    console.log('Complex case:', file, '- skipping');
    continue;
  }
  
  if (resultLines.join('\n') !== content) {
    fs.writeFileSync(filePath, resultLines.join('\n'));
    console.log('FIXED:', file);
  } else {
    console.log('SKIP (no change):', file);
  }
}
