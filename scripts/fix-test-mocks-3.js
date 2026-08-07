const fs = require('fs');
const path = require('path');

const files = [
  'src/__tests__/action.service.test.ts',
  'src/__tests__/application-merge.service.test.ts',
  'src/__tests__/application-timeline.service.test.ts',
  'src/__tests__/email-worker.test.ts',
  'src/__tests__/fact.service.test.ts',
  'src/__tests__/job-analytics.service.test.ts',
  'src/__tests__/placement.service.test.ts',
  'src/__tests__/security-hardening.test.ts',
  'src/__tests__/user-action-log.test.ts',
  'src/__tests__/zzz-dbg.test.ts',
];

for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log('SKIP (not found):', file);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix pattern where dbRouter is the last item inside prisma object:
  //   prisma: {
  //     someProp: { ... }
  //   dbRouter: { ... },,
  //   },
  // Should become:
  //   prisma: {
  //     someProp: { ... }
  //   },
  //   dbRouter: { ... },
  
  const fixRegex = /(prisma:\s*\{[\s\S]*?)(\n\s*dbRouter:\s*\{[\s\S]*?\}\s*,)\s*,\s*\n(\s*\}),/;
  
  if (fixRegex.test(content)) {
    content = content.replace(fixRegex, (match, prismaStart, dbRouterBlock, closingBrace) => {
      return prismaStart + ',\n  },\n' + dbRouterBlock + '\n' + closingBrace + ',';
    });
    
    fs.writeFileSync(filePath, content);
    console.log('FIXED:', file);
  } else {
    console.log('SKIP (pattern not found):', file);
    console.log('  Checking for ,, pattern...');
    if (content.includes(',,')) {
      console.log('  -> Still has ,,');
    }
  }
}
