const fs = require('fs');
const f = 'apps/api/src/services/__tests__/modelPreferenceService.test.ts';
let c = fs.readFileSync(f, 'utf8');
c = c.replace(/updateModelPreferences\(userId,\s*\{/g, 'updateModelPreferences(userId, "test-ws", {');
c = c.replace(/setDefaultModel\(userId,\s*"([^"]+)"\)/g, 'setDefaultModel(userId, "test-ws", "$1")');
fs.writeFileSync(f, c);
console.log('Fixed modelPreferenceService.test.ts');
