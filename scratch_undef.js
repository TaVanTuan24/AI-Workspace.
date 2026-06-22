const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(file, content);
}

// notificationDelivery.ts
repl('apps/api/src/routes/notificationDelivery.ts', /upsertPreference\(request\.user\.id,\s*"in_app",/g, 'upsertPreference(request.user.id, request.user.workspaceId!, "in_app",');

// notificationDeliveryPreferenceService.ts
repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', /export async function ensureDefaultPreferences\(userId: string\) \{/, 'export async function ensureDefaultPreferences(userId: string, workspaceId: string) {');
repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', /userId,\n\s*workspaceId,\n\s*channel:/g, 'userId,\n          workspaceId: typeof workspaceId !== "undefined" ? workspaceId : null,\n          channel:');

// notificationWebhookDestinationService.ts
repl('apps/api/src/services/notificationWebhookDestinationService.ts', /listWebhookDestinations\(userId: string\)/, 'listWebhookDestinations(userId: string, workspaceId?: string)');
repl('apps/api/src/services/notificationWebhookDestinationService.ts', /userId,\n\s*workspaceId,\n\s*name: "Default Webhook"/, 'userId,\n            workspaceId: workspaceId || null,\n            name: "Default Webhook"');

// providerHealthIncidentService.ts
repl('apps/api/src/services/providerHealthIncidentService.ts', /userId,\n\s*workspaceId,\n\s*provider:/g, 'userId,\n          workspaceId: typeof workspaceId !== "undefined" ? workspaceId : null,\n          provider:');

// providerRecoveryPolicyService.ts
repl('apps/api/src/services/providerRecoveryPolicyService.ts', /userId,\n\s*workspaceId,\n\s*name:/g, 'userId,\n          workspaceId: typeof workspaceId !== "undefined" ? workspaceId : null,\n          name:');

console.log('Fixed undefined variables');
