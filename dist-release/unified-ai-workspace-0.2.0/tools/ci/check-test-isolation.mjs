import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');

// Allow overriding directories to scan via process arguments for testing
const args = process.argv.slice(2);
const directoriesToScan = args.length > 0 ? args.map(arg => path.resolve(arg)) : [
  path.join(ROOT_DIR, 'apps/api/src'),
  path.join(ROOT_DIR, 'apps/worker/src'),
  path.join(ROOT_DIR, 'packages'),
];

const RISKY_PATTERNS = [
  {
    regex: /\b(deleteMany|updateMany)\(\s*(?:\{\s*(?:where:\s*\{\s*\})?\s*\})?\s*\)/,
    category: 'global-prisma-mutation'
  },
  {
    regex: /\.\$executeRaw\b|\.\$executeRawUnsafe\b|\.\$queryRawUnsafe\b/,
    category: 'raw-sql-execution'
  },
  {
    regex: /\.\$queryRaw\b.*?(DELETE|TRUNCATE|DROP|ALTER|INSERT|UPDATE|CREATE|VACUUM|PRAGMA\s+writable_schema)/i,
    category: 'raw-sql-mutation'
  },
  {
    regex: /\b(TRUNCATE\s+TABLE|DELETE\s+FROM|DROP\s+TABLE|DROP\s+DATABASE|ALTER\s+TABLE|VACUUM|PRAGMA\s+writable_schema)\b/i,
    category: 'raw-sql-mutation'
  }
];

const ALLOW_COMMENTS = [
  '// test-isolation-allow-global-cleanup:',
  '// test-isolation-allow-raw-sql:'
];

function getFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (dir.endsWith('.test.ts') || dir.endsWith('.spec.ts')) {
      return [dir];
    }
    return [];
  }
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Do not scan node_modules, dist, dist-release
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-release'].includes(entry.name)) {
        files.push(...getFilesRecursively(fullPath));
      }
    } else if (entry.isFile() && (fullPath.endsWith('.test.ts') || fullPath.endsWith('.spec.ts'))) {
      files.push(fullPath);
    }
  }
  return files;
}

let errors = 0;

for (const dir of directoriesToScan) {
  const files = getFilesRecursively(dir);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      let matchedPattern = null;
      let matchedCategory = null;

      for (const pattern of RISKY_PATTERNS) {
        if (pattern.regex.test(line)) {
          matchedPattern = line.trim();
          matchedCategory = pattern.category;
          break;
        }
      }

      if (matchedCategory) {
        // Check if allowlisted by comment on same line or previous line
        let allowReason = null;
        const checkComment = (text) => {
          for (const prefix of ALLOW_COMMENTS) {
            const idx = text.indexOf(prefix);
            if (idx !== -1) {
              const reason = text.substring(idx + prefix.length).trim();
              if (reason.length >= 10) {
                return reason;
              }
            }
          }
          return null;
        };

        allowReason = checkComment(line) || (index > 0 ? checkComment(lines[index - 1]) : null);

        if (!allowReason) {
          console.error(`\n❌ Risky pattern found in test file:`);
          console.error(`   File: ${file.replace(ROOT_DIR, '')}:${index + 1}`);
          console.error(`   Line: ${line.trim()}`);
          console.error(`   Risk: ${matchedCategory}`);
          
          if (matchedCategory === 'global-prisma-mutation') {
            console.error(`   Suggested fix: Use 'cleanupTestUserData(userId)' or scope 'where' to a specific userId.`);
            console.error(`   Allow comment: // test-isolation-allow-global-cleanup: <reason>`);
          } else {
            console.error(`   Suggested fix: Avoid raw SQL. Use Prisma ORM methods instead.`);
            console.error(`   Allow comment: // test-isolation-allow-raw-sql: <reason>`);
          }
          errors++;
        }
      }
    });
  }
}

if (errors > 0) {
  console.error(`\n💥 Failed: Found ${errors} risky global DB cleanup or raw SQL calls in test files.`);
  console.error(`Run 'pnpm test:isolation' locally to check.`);
  process.exit(1);
} else {
  console.log(`✅ Test isolation static check passed. No global mutations or unsafe raw SQL found.`);
}
