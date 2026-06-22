const fs = require('fs');
const glob = require('fs').readdirSync;
const path = require('path');

function replaceInFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const rep of replacements) {
    const newContent = content.replace(rep.regex, rep.replacement);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('Fixed', filePath);
  }
}

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (file.endsWith('.ts')) {
      replaceInFile(fullPath, [
        // Inject workspaceId: request.user.workspaceId! in routes
        {
          regex: /userId:\s*request\.user\.id,/g,
          replacement: 'userId: request.user.id,\n        workspaceId: request.user.workspaceId!,'
        },
      ]);
    }
  }
}

// Routes
processDir('apps/api/src/routes');

// For services, they usually take (userId: string, workspaceId: string, ...)
// We need to be more careful.

console.log('Done routes');
