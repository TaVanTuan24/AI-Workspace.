const fs = require('fs');

function repl(file, search, replace) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(file, content);
}

repl('apps/api/src/services/__tests__/notificationDeliveryPreferenceService.test.ts', 
  /updateNotificationDeliveryPreference\(userId, "email_noop", \{ enabled: true \}\)/g, 
  'updateNotificationDeliveryPreference(userId, "test-ws", "email_noop", { enabled: true })');

repl('apps/api/src/services/__tests__/notificationDeliveryPreferenceService.test.ts', 
  /updateNotificationDeliveryPreference\(userId, "in_app", \{ enabled: false \}\)/g, 
  'updateNotificationDeliveryPreference(userId, "test-ws", "in_app", { enabled: false })');

console.log('Fixed delivery preference test');
