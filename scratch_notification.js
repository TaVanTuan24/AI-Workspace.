const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(file, content);
}

// notificationDelivery.ts
repl('apps/api/src/routes/notificationDelivery.ts', 
  /createWebhookDestination\(request\.user\.id, request\.body\)/g, 
  'createWebhookDestination(request.user.id, request.user.workspaceId!, request.body)');

// tests
repl('apps/api/src/services/__tests__/notificationDeliveryPreferenceService.test.ts', 
  /updateNotificationDeliveryPreference\(userId, "webhook", \{ enabled: true \}\)/g, 
  'updateNotificationDeliveryPreference(userId, "test-ws", "webhook", { enabled: true })');

repl('apps/api/src/services/__tests__/notificationDeliveryService.test.ts', 
  /updateNotificationDeliveryPreference\(userId, "webhook", \{ enabled: true \}\)/g, 
  'updateNotificationDeliveryPreference(userId, "test-ws", "webhook", { enabled: true })');

console.log('Fixed notification errors');
