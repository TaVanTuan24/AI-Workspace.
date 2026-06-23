# Testing Conventions

This project utilizes a structured testing approach to guarantee isolation, safety, and correctness across a multi-tenant workspace architecture.

## Workspace Isolation Testing
All tests that interact with workspace-scoped resources **MUST** use the `createWorkspaceTestContext` helper located in `apps/api/src/test/workspaceTestContext.ts`.

### Why?
1. **No Implicit Defaults**: It prevents tests from passing accidentally due to relying on a shared "default" workspace.
2. **Explicit Membership**: It forces the test to declare the exact role (e.g., owner, member) being tested.
3. **Data Segregation**: It ensures that DB asserts only match records belonging to the generated `workspaceId`.

### Example
```typescript
import { createWorkspaceTestContext, buildAuthHeaders } from "../../test/workspaceTestContext.ts";

describe("My Route", () => {
  it("should isolate data", async () => {
    const ctxA = await createWorkspaceTestContext("ws-a");
    const ctxB = await createWorkspaceTestContext("ws-b");

    // Operations with ctxA should never impact ctxB
    const res = await app.inject({
      method: "GET",
      url: "/my-route",
      headers: buildAuthHeaders(ctxB)
    });
  });
});
```

## Serialization Safety Guard
All APIs that return large object graphs or export data must be validated against `assertSafeSerializedPayload` (in `apps/api/src/test/assertSafePayload.ts`).

### Why?
We must guarantee that secrets (API keys, session tokens, passwords) and PII/prompt text never leak into Admin exports or generalized activity streams.

### Example
```typescript
import { assertSafeSerializedPayload } from "../../test/assertSafePayload.ts";

it("returns safe payload", async () => {
  const res = await app.inject({ /* ... */ });
  const body = JSON.parse(res.payload);
  
  // This will throw if any key matches a forbidden pattern (e.g. 'tokenHash')
  assertSafeSerializedPayload(body);
});
```

## Execution
- Ensure `pnpm typecheck` passes cleanly before running tests.
- Backend tests are run via `pnpm -r test` which runs Vitest.
- Frontend tests are similarly run via Vitest.
