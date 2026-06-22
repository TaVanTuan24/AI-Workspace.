const fs = require('fs');

const f1 = 'apps/api/src/routes/chat.ts';
let c1 = fs.readFileSync(f1, 'utf8');
c1 = c1.replace(/userId:\s*request\.user\.id,\s*provider:/g, 'userId: request.user.id,\nworkspaceId: request.user.workspaceId!,\nprovider:');
c1 = c1.replace(/userId:\s*request\.user\.id,\n\s*provider:/g, 'userId: request.user.id,\nworkspaceId: request.user.workspaceId!,\nprovider:');
fs.writeFileSync(f1, c1);

const f2 = 'apps/api/src/services/rateLimiter.ts';
let c2 = fs.readFileSync(f2, 'utf8');
c2 = c2.replace(/userId:\s*request\.user\.id,\n\s*apiKeyId:/g, 'userId: request.user.id,\nworkspaceId: request.user.workspaceId!,\napiKeyId:');
c2 = c2.replace(/userId:\s*request\.user\.id,\s*apiKeyId:/g, 'userId: request.user.id,\nworkspaceId: request.user.workspaceId!,\napiKeyId:');
fs.writeFileSync(f2, c2);

const f3 = 'apps/api/src/services/__tests__/apiUsageService.test.ts';
let c3 = fs.readFileSync(f3, 'utf8');
c3 = c3.replace(/userId:\s*"([^"]+)",/g, 'userId: "$1", workspaceId: "test-ws",');
c3 = c3.replace(/userId:\s*userId,/g, 'userId: userId, workspaceId: "test-ws",');
fs.writeFileSync(f3, c3);
console.log('done');
