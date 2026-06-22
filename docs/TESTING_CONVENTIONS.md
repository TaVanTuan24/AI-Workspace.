# Testing Conventions

## 1. Workspace Test Context

When writing tests that interact with workspace-scoped data (such as API routes, services, or models), you must explicitly define the workspace context. 

### Why?
Historically, tests relied on an implicit "default workspace fallback" that created a local workspace on-the-fly. This triggered repetitive `upsert` queries for users and memberships on every test, leading to SQLite database locks under high concurrency with Vitest.

### How to use
Use the helper from `apps/api/src/test/workspaceTestContext.ts`:

```typescript
import { createWorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.js";

// For service tests needing real data:
const context = await createWorkspaceTestContext("service-test", { role: "admin" });

// For route tests (to inject headers):
const response = await app.inject({
  method: "GET",
  url: "/some/route",
  headers: buildAuthHeaders(context)
});
```

For route tests that purely need to mock authorization, you can use `mockWorkspaceContext` to prevent DB hits entirely.

## 2. Test Cleanup & Isolation

Do not use global `deleteMany({})` for test cleanup. It leads to race conditions in parallel test execution.
Furthermore, **do not rely on SQLite's `ON DELETE CASCADE`** behavior, as it is disabled by default in SQLite and may leave dangling child rows if not explicitly enabled per connection.

### How to use
Always use the scoped `cleanupTestUserData` function from `apps/api/src/test/testIsolation.ts`:

```typescript
import { withTestUserScope } from "../../test/testIsolation.js";

const scope = withTestUserScope("my-test");

afterEach(async () => {
  await scope.cleanup();
});
```

## 3. SQLite Concurrency Hardening

- Do not globally mock broad objects or functions unless strictly necessary.
- If a test file performs extremely heavy DB setup and teardown, ensure it correctly isolates its records via scoped run IDs.
- Avoid raw SQL execution (`$executeRawUnsafe`) in tests.
- **Avoid `Promise.all` Prisma cleanup on SQLite:** Running multiple `prisma.*.deleteMany` queries concurrently will often trigger `SQLITE_BUSY` locks. Execute cleanups sequentially with standard `await`.
- **Workspace creation tests must register scoped cleanup:** Any dynamically created models (like `Workspace`) must be securely tied to test isolation context so `testIsolation.ts` can delete them.
- **Route tests must use explicit workspace context:** Rather than mocking default workspaces globally, spawn real contextual relationships via `createWorkspaceTestContext()`.
- **Never dismiss hook timeout as harmless:** A `beforeEach`/`afterEach` hook timeout is usually a symptom of SQLite concurrency deadlock or dirty state leak, not a slow runner.
- CI static analysis (`tools/ci/check-test-isolation.mjs`) will flag unscoped workspace mutations or implicit default workspace fallbacks. You can bypass this with an explicit comment if valid: `// test-isolation-allow-global-cleanup: valid reason`.
