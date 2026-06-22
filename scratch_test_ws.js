const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(file, content);
}

const workspaceCreate = `
    await prisma.workspace.upsert({
      where: { id: "test-ws" },
      update: {},
      create: { id: "test-ws", name: "Test Workspace", slug: "test-ws-" + Math.random().toString(36).substring(7) }
    });
`;

function injectWorkspace(file) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('test-ws') && !content.includes('prisma.workspace.upsert')) {
    content = content.replace(/beforeEach\(async \(\) => \{/, 'beforeEach(async () => {\n' + workspaceCreate);
    fs.writeFileSync(file, content);
  }
}

injectWorkspace('apps/api/src/services/__tests__/modelPreferenceService.test.ts');
injectWorkspace('apps/api/src/services/__tests__/notificationDeliveryPreferenceService.test.ts');
injectWorkspace('apps/api/src/services/__tests__/notificationDeliveryService.test.ts');
injectWorkspace('apps/api/src/services/__tests__/providerDiagnosticsDriftAlerts.test.ts');
injectWorkspace('apps/api/src/routes/__tests__/providerHealthIncidents.test.ts');
injectWorkspace('apps/api/src/routes/__tests__/providerRecoveryPolicies.test.ts');

console.log('Fixed workspaces in tests');
