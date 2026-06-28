import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');

let content = fs.readFileSync(schemaPath, 'utf8');

const modelsToUpdate = [
    'ProviderConnection', 'ProviderDiagnosticsBaseline', 'ProviderDiagnosticsDriftAlert',
    'ProviderDiagnosticsRun', 'ProviderHealthIncident', 'InternalApiKey',
    'InternalApiUsageLog', 'UserModelPreference', 'ProviderRateLimitSetting'
];

for (const model of modelsToUpdate) {
    const pattern = new RegExp(`(model\\s+${model}\\s+\\{[^]*?^\\})`, 'm');
    const match = pattern.exec(content);
    if (!match) {
        console.log(`Model ${model} not found`);
        continue;
    }

    let block = match[1];

    if (block.includes('workspaceId String?')) {
        console.log(`Model ${model} already updated`);
        continue;
    }

    // Replace userId with workspaceId and userId
    block = block.replace(/(\n\s+)(userId\s+String\s+@map\("user_id"\))/, '$1workspaceId String? @map("workspace_id")$1workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)$1$2');

    // Some models use slightly different spacing. The above regex handles standard
    // formatting; this fallback covers the rest.
    if (!block.includes('workspaceId String?')) {
         block = block.replace(/(\n\s*)(userId\s+String\s+@map\("user_id"\))/, '$1workspaceId String? @map("workspace_id")$1workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)$1$2');
    }

    // Note: User relation remains as-is, we added workspace relation above it.
    // We don't need to replace `user User` relation because we just prepended our relation.
    
    // Add index
    block = block.replace(/(\n\s*)(@@map\(".*?"\))/, '$1@@index([workspaceId])$1$2');

    content = content.replace(match[1], block);
    console.log(`Updated model ${model}`);
}

fs.writeFileSync(schemaPath, content, 'utf8');
console.log('schema.prisma updated successfully.');
