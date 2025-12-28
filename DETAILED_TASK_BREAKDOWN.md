# RAPPIT Production Task Breakdown

This document converts the Phased Delivery Plan into executable, testable tasks.

**Status**: Ready for Sprint Planning
**Total Scope**: 8 Weeks

---

## PHASE 1 — Foundations & Security Hardening

### MODULE: Infrastructure

#### 1. Task: Create Production Multi-Stage Dockerfile
-   **User Story**: As an Ops Engineer, I want a lightweight, secure Docker image, so that I can deploy to production without leaking source code or dev dependencies.
-   **Description**:
    -   Create `Dockerfile` in root.
    -   Stage 1 (Builder): Install deps, build NestJS (dist), build Next.js.
    -   Stage 2 (Runner): Alpine Node image, copy `dist` / `.next`, install production deps only.
    -   Ensure `docker-compose.yml` (if used for prod) references this image.
-   **Acceptance Criteria**:
    -   `docker build -t rappit-prod .` succeeds.
    -   Image size is < 500MB (target < 300MB).
    -   Container starts and health check passes.
    -   No source code (`src/`) exists in the final image, only build artifacts.
-   **Mandatory Tests**:
    -   *Test Completion Rule*: Task CANNOT be marked complete unless image builds and runs.
    -   *Ops Test*: Build image, run container, `curl localhost:3000/health` (or API port).
-   **Test Ownership**: Ops
-   **Dependencies**: None
-   **Scope**: Ops
-   **Priority**: Critical
-   **Estimated Effort**: Small (1 day)

#### 2. Task: Set up Basic CI/CD Pipeline
-   **User Story**: As a Developer, I want automated feedback on my code, so that I don't break the build.
-   **Description**:
    -   Create GitHub Actions workflow (`.github/workflows/ci.yml`).
    -   Jobs: Lint, Build (Backend + Frontend), Unit Test (Jest).
    -   Trigger on Push to Main and PRs.
-   **Acceptance Criteria**:
    -   Pushing code triggers the workflow.
    -   Failing tests block the PR merge (if branch protection enabled).
-   **Mandatory Tests**:
    -   *Integration Test*: Create a PR with a failing test -> CI fails. Create a PR with passing tests -> CI passes.
-   **Test Ownership**: Ops
-   **Dependencies**: None
-   **Scope**: Ops
-   **Priority**: Critical
-   **Estimated Effort**: Small (1 day)

### MODULE: Security

#### 3. Task: Implement EncryptionService
-   **User Story**: As a Security Engineer, I want sensitive tokens encrypted at rest, so that a database leak doesn't compromise merchant stores.
-   **Description**:
    -   Create `src/src/common/services/encryption.service.ts`.
    -   Use `crypto` module (AES-256-GCM).
    -   Methods: `encrypt(text: string): string`, `decrypt(hash: string): string`.
    -   Key source: `process.env.ENCRYPTION_KEY` (Fail if missing).
-   **Acceptance Criteria**:
    -   Encrypted string is not human readable.
    -   Decrypting the output returns original string.
    -   Different IV used for each encryption (randomized).
-   **Mandatory Tests**:
    -   *Unit Test*: `encrypt('hello')` returns string != 'hello'.
    -   *Unit Test*: `decrypt(encrypt('hello'))` === 'hello'.
    -   *Unit Test*: `encrypt('hello')` !== `encrypt('hello')` (due to random IV).
-   **Test Ownership**: Backend
-   **Dependencies**: None
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Small (1 day)

#### 4. Task: Migrate Hardcoded Secrets to Environment Variables
-   **User Story**: As a Security Auditor, I want no secrets in the codebase, so that source code leaks don't compromise infrastructure.
-   **Description**:
    -   Audit `src/src/config/configuration.ts` and all service files.
    -   Replace defaults like `'dev-secret-change-me'` with `process.env.VAR`.
    -   Throw error on startup if critical secrets (JWT, DB, Encryption) are missing in production mode.
-   **Acceptance Criteria**:
    -   `grep -r "secret" src/` shows no hardcoded credential strings.
    -   App crashes if `.env` is missing critical keys.
-   **Mandatory Tests**:
    -   *Unit Test*: Config loader throws if `JWT_SECRET` is undefined.
-   **Test Ownership**: Backend
-   **Dependencies**: None
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Small (1 day)

#### 5. Task: Implement Global API Rate Limiting
-   **User Story**: As an Ops Engineer, I want to limit API abuse, so that the system remains stable under attack.
-   **Description**:
    -   Install `@nestjs/throttler`.
    -   Configure global guard in `AppModule`.
    -   Default limit: 60 requests / minute per IP.
    -   Allow specific override decorators for heavy/light endpoints.
-   **Acceptance Criteria**:
    -   Spamming the API returns 429 Too Many Requests.
-   **Mandatory Tests**:
    -   *Integration Test*: Send 70 requests in loop -> expect 429 after 60th.
-   **Test Ownership**: Backend
-   **Dependencies**: Redis (optional but recommended for storage).
-   **Scope**: Backend
-   **Priority**: High
-   **Estimated Effort**: Small (1 day)

### MODULE: Core Foundations

#### 6. Task: Implement Global Prisma Scoping Middleware
-   **User Story**: As a Principal Engineer, I want to guarantee tenant isolation, so that developers cannot accidentally leak data.
-   **Description**:
    -   Implement Prisma Client Extension or Middleware.
    -   Intercept `findMany`, `findFirst`, `count`, `updateMany`, `deleteMany`.
    -   Inject `where: { organizationId: currentOrgId }` automatically.
    -   Allow a specific "Bypass" context for Admin/System jobs.
-   **Acceptance Criteria**:
    -   Querying `db.order.findMany()` returns ONLY orders for the active org context.
-   **Mandatory Tests**:
    -   *Integration Test*: Create Orders for Org A and Org B. Context = Org A. Query `findMany`. Assert result count = Org A count.
-   **Test Ownership**: Backend
-   **Dependencies**: None
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Medium (3 days)

---

## PHASE 2 — Inventory Reliability

### MODULE: Database

#### 7. Task: Add Negative Inventory DB Constraint
-   **User Story**: As a Database Admin, I want the database to reject invalid states, so that data integrity is preserved even if code fails.
-   **Description**:
    -   Create Prisma migration (`sql` file if needed).
    -   `ALTER TABLE inventory_levels ADD CONSTRAINT check_positive_stock CHECK (quantity_available >= 0);`
-   **Acceptance Criteria**:
    -   Manual SQL update setting negative value fails.
-   **Mandatory Tests**:
    -   *Integration Test*: Try to update inventory to -1 via Prisma -> Expect Exception.
-   **Test Ownership**: Backend
-   **Dependencies**: None
-   **Scope**: Database
-   **Priority**: Critical
-   **Estimated Effort**: Small (1 day)

### MODULE: Inventory Core

#### 8. Task: Implement Inventory Concurrency Locking
-   **User Story**: As a Merchant, I want to avoid selling the same item twice, so that I don't disappoint customers.
-   **Description**:
    -   Update `InventoryService.reserveStock` and `adjustStock`.
    -   Use Interactive Transaction.
    -   Use raw SQL `SELECT ... FOR UPDATE` or Prisma `$executeRaw` to lock the `inventory_level` row before reading.
-   **Acceptance Criteria**:
    -   Two concurrent requests for 1 item (stock=1) result in 1 success, 1 failure (or wait).
-   **Mandatory Tests**:
    -   *Integration Test*: `Promise.all([reserve(1), reserve(1)])` on stock=1. Assert 1 succeeds, 1 throws "Insufficient Stock".
-   **Test Ownership**: Backend
-   **Dependencies**: Task 7 (DB Constraint).
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Small (2 days)

#### 9. Task: Build Bulk Inventory Import Endpoint
-   **User Story**: As a Merchant, I want to upload my stock via CSV, so that I can set up my store quickly.
-   **Description**:
    -   `POST /inventory/bulk` (Multipart/form-data).
    -   Parse CSV.
    -   Validate SKUs exist.
    -   Upsert `InventoryLevel` records in a Transaction.
    -   Limit: 2000 rows per request.
-   **Acceptance Criteria**:
    -   Valid CSV updates stock.
    -   Invalid SKU in row 50 causes partial failure OR total rollback (decide strategy: Atomic or Best Effort. *Decision: Atomic for MVP*).
-   **Mandatory Tests**:
    -   *Integration Test*: Upload CSV with 100 items -> DB reflects 100 updates.
    -   *Unit Test*: Upload CSV with bad header -> Returns 400.
-   **Test Ownership**: Backend
-   **Dependencies**: Task 6 (Global Scoping).
-   **Scope**: Backend
-   **Priority**: High
-   **Estimated Effort**: Medium (3 days)

### MODULE: Frontend

#### 10. Task: Build Bulk Import UI
-   **User Story**: As an Operator, I want a drag-and-drop interface for CSVs, so that I don't need to use API tools.
-   **Description**:
    -   New Page: `/inventory/import`.
    -   File Input (Accept .csv).
    -   "Upload" button.
    -   Show Progress spinner.
    -   Show Success/Error summary table.
-   **Acceptance Criteria**:
    -   User can select file and upload.
    -   Success message displayed on completion.
    -   Error rows displayed if validation fails.
-   **Mandatory Tests**:
    -   *E2E Test (Playwright)*: Upload valid file -> verify Success toast.
-   **Test Ownership**: Frontend
-   **Dependencies**: Task 9 (API).
-   **Scope**: Frontend
-   **Priority**: Medium
-   **Estimated Effort**: Medium (3 days)

---

## PHASE 3 — Secure Integrations (OAuth)

### MODULE: Integration Authentication

#### 11. Task: Implement Shopify OAuth 2.0 Flow
-   **User Story**: As a Merchant, I want to connect Shopify securely, so that I don't have to share passwords.
-   **Description**:
    -   Endpoints: `GET /auth/shopify/install`, `GET /auth/shopify/callback`.
    -   Validate `hmac` query param.
    -   Exchange `code` for `access_token` (Offline mode).
    -   Store Encrypted token in `Channel.config`.
-   **Acceptance Criteria**:
    -   Completing flow creates a valid `Channel` record.
    -   Token is encrypted in DB.
-   **Mandatory Tests**:
    -   *Integration Test*: Mock Shopify API responses. Call endpoints. Verify DB record created with encrypted token.
-   **Test Ownership**: Backend
-   **Dependencies**: Task 3 (EncryptionService).
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Medium (3 days)

#### 12. Task: Implement FedEx Client Credentials Flow
-   **User Story**: As a System, I want to authenticate with FedEx using modern standards, so that I comply with their API deprecation.
-   **Description**:
    -   Store Client ID / Secret in `ShippingAccount`.
    -   Create `FedexTokenService`.
    -   Method `getToken()`: Check Redis cache -> If missing, call FedEx `oauth/token` -> Cache with TTL -> Return.
-   **Acceptance Criteria**:
    -   `getToken()` returns valid string.
    -   Subsequent calls return cached token.
    -   Token refresh happens automatically on expiry.
-   **Mandatory Tests**:
    -   *Unit Test*: Mock Cache Miss -> Verify API Call.
    -   *Unit Test*: Mock Cache Hit -> Verify No API Call.
-   **Test Ownership**: Backend
-   **Dependencies**: Redis, Task 3 (Encryption).
-   **Scope**: Backend
-   **Priority**: Critical
-   **Estimated Effort**: Medium (2 days)

#### 13. Task: Build Channel Connection UI
-   **User Story**: As a User, I want to click "Connect Shopify", so that I can link my store easily.
-   **Description**:
    -   Settings -> Channels -> "Add Channel".
    -   Shopify: Input "myshop.shopify.com" -> Redirect to Backend Install URL.
    -   Handle Redirect back (Success/Fail).
-   **Acceptance Criteria**:
    -   Clicking Connect initiates OAuth.
    -   Returning shows "Connected" badge.
-   **Mandatory Tests**:
    -   *E2E Test*: Click Connect -> Check URL redirection.
-   **Test Ownership**: Frontend
-   **Dependencies**: Task 11.
-   **Scope**: Frontend
-   **Priority**: High
-   **Estimated Effort**: Medium (3 days)

---

## PHASE 4 — Order Ingestion & Resilience

### MODULE: Webhooks

#### 14. Task: Implement Webhook HMAC Verification
-   **User Story**: As a Security Engineer, I want to reject fake webhooks, so that hackers cannot inject orders.
-   **Description**:
    -   Middleware `WebhookVerificationGuard`.
    -   Fetch `Channel` secret from DB (Encrypted).
    -   Compute HMAC of body. Compare with Header (`X-Shopify-Hmac-Sha256`).
    -   Throw 401 if mismatch.
-   **Acceptance Criteria**:
    -   Valid signature passes.
    -   Tampered body fails.
-   **Mandatory Tests**:
    -   *Unit Test*: Pass valid body+secret -> true. Pass modified body -> false.
-   **Test Ownership**: Backend
-   **Dependencies**: Task 3 (Encryption), Task 11 (Channel Setup).
-   **Scope**: Security
-   **Priority**: Critical
-   **Estimated Effort**: Small (2 days)

#### 15. Task: Configure Dead Letter Queue (DLQ)
-   **User Story**: As an Ops Engineer, I want failed webhooks saved, so that I can replay them after fixing bugs.
-   **Description**:
    -   Configure BullMQ `webhook` queue.
    -   Set `attempts: 3`, `backoff: exponential`.
    -   Define `removeOnFail: false` (or move to separate DLQ).
-   **Acceptance Criteria**:
    -   Job failing 3 times stays in Redis Set "failed".
-   **Mandatory Tests**:
    -   *Integration Test*: Throw error in worker 3 times -> Check Queue Job Status is 'failed'.
-   **Test Ownership**: Backend
-   **Dependencies**: Redis.
-   **Scope**: Backend
-   **Priority**: High
-   **Estimated Effort**: Small (1 day)

### MODULE: Orders

#### 16. Task: Enforce Order Idempotency
-   **User Story**: As a Data Analyst, I want unique orders, so that reporting is accurate.
-   **Description**:
    -   Add DB Unique Index: `(organizationId, channelId, externalOrderId)`.
    -   Update `OrdersService.createFromChannel`: Catch Unique Constraint Violation -> Return "Success" (Idempotent success) or Update existing.
-   **Acceptance Criteria**:
    -   Posting same payload twice results in 1 DB row.
    -   API returns 2xx for both calls.
-   **Mandatory Tests**:
    -   *Integration Test*: Call `createFromChannel` twice. Assert DB count = 1.
-   **Test Ownership**: Backend
-   **Dependencies**: None.
-   **Scope**: Backend
-   **Priority**: Medium
-   **Estimated Effort**: Small (1 day)

---

## PHASE 5 — Fulfillment & Shipping Hardening

### MODULE: Shipping

#### 17. Task: Implement Carrier Circuit Breakers
-   **User Story**: As a System, I want to stop calling a dead API, so that I don't clog my queues.
-   **Description**:
    -   Use `cockatiel` or similar.
    -   Wrap `FedexService` calls.
    -   Policy: Open circuit after 5 failures in 1 minute. Reset after 5 minutes.
-   **Acceptance Criteria**:
    -   6th call fails immediately without network request.
-   **Mandatory Tests**:
    -   *Unit Test*: Mock Axios to fail 5 times. Assert 6th call throws "CircuitOpenException".
-   **Test Ownership**: Backend
-   **Dependencies**: None.
-   **Scope**: Backend
-   **Priority**: Medium
-   **Estimated Effort**: Small (2 days)

---

## PHASE 6 — Operational Readiness & Launch

### MODULE: Observability

#### 18. Task: Configure JSON Structured Logging
-   **User Story**: As a Developer, I want logs in JSON, so that I can query them in Datadog.
-   **Description**:
    -   Configure `winston` / `nestjs-pino`.
    -   Format: JSON.
    -   Include: `traceId`, `organizationId` (from Context), `level`, `message`.
-   **Acceptance Criteria**:
    -   Stdout shows `{"level":"info","traceId":"...","msg":"..."}`.
-   **Mandatory Tests**:
    -   *Manual Verification*: Run app, curl endpoint, check console output.
-   **Test Ownership**: Ops
-   **Dependencies**: None.
-   **Scope**: Ops
-   **Priority**: Medium
-   **Estimated Effort**: Small (1 day)

### MODULE: Documentation

#### 19. Task: Create Tenant Onboarding Runbook
-   **User Story**: As a Support Agent, I want a guide to add new clients, so that I don't block Sales.
-   **Description**:
    -   Write `docs/runbooks/ONBOARDING.md`.
    -   Steps: Create Org (SQL/API), Create Admin User, Configure defaults.
-   **Acceptance Criteria**:
    -   Peer review confirms steps are reproducible.
-   **Mandatory Tests**:
    -   *Manual Verification*: Follow runbook to create a new tenant.
-   **Test Ownership**: Product
-   **Dependencies**: None.
-   **Scope**: Ops
-   **Priority**: High
-   **Estimated Effort**: Small (1 day)

---

## HALLUCINATION & QUALITY CHECK

**Unspecified Items**:
-   *Specific UI Designs*: The plan assumes a generic "Connect Channel" UI. Exact layout is unspecified.
-   *Retry Policies*: Exact backoff timings for DLQ are unspecified (assumed standard exponential).
-   *Log Aggregator*: Specific provider (Datadog vs CloudWatch) is generic.

**Quality Confirmation**:
-   No behavior was invented beyond standard implementation of the named requirements (e.g., standard OAuth flows).
-   Every task includes a "Mandatory Tests" section.
-   **Constraint**: No task can be completed without passing tests.

**Summary**:
1.  **Total Tasks**: 19
2.  **Critical Tasks**: 10
3.  **Final Statement**: "If all Critical and High tasks are fully implemented and all tests pass, the system is production-ready."
