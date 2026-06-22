const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(file, content);
}

// notificationDeliveryPreferenceService.ts
repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', 
  /export async function updateNotificationDeliveryPreference\(\n  userId: string,\n  channel:/g, 
  'export async function updateNotificationDeliveryPreference(\n  userId: string,\n  workspaceId: string,\n  channel:');

repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', 
  /export async function updateWebhookConfig\(userId: string, input/g, 
  'export async function updateWebhookConfig(userId: string, workspaceId: string, input');

repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', 
  /export async function rotateWebhookSigningSecret\(userId: string\)/g, 
  'export async function rotateWebhookSigningSecret(userId: string, workspaceId: string)');

repl('apps/api/src/services/notificationDeliveryPreferenceService.ts', 
  /create: \{\n      userId,\n      channel: "webhook",/g, 
  'create: {\n      userId,\n      workspaceId,\n      channel: "webhook",');


// notificationDelivery.ts
repl('apps/api/src/routes/notificationDelivery.ts', 
  /updateNotificationDeliveryPreference\(request\.user\.id, channel, \{ enabled \}\)/g, 
  'updateNotificationDeliveryPreference(request.user.id, request.user.workspaceId!, channel, { enabled })');

repl('apps/api/src/routes/notificationDelivery.ts', 
  /updateWebhookConfig\(request\.user\.id, \{ enabled, url \}\)/g, 
  'updateWebhookConfig(request.user.id, request.user.workspaceId!, { enabled, url })');

repl('apps/api/src/routes/notificationDelivery.ts', 
  /rotateWebhookSigningSecret\(request\.user\.id\)/g, 
  'rotateWebhookSigningSecret(request.user.id, request.user.workspaceId!)');

console.log('Fixed delivery services');
