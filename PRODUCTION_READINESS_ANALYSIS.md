# RAPPIT Production-Readiness Gap Analysis

**Executive Summary**
This document provides a critical analysis of the RAPPIT platform's readiness for production. It is grounded in the current codebase and architectural documentation.

## 1. Multi-Tenancy & Organization Isolation

### Current State
-   **Implementation**: Strong database-level isolation. Almost all entities (`Order`, `InventoryItem`, `Customer`) include `organizationId`.
-   **Enforcement**: `OrganizationGuard` and `JwtStrategy` validate `orgId` from the token. Controllers use `@OrganizationId()` decorator to scope queries.
-   **Maturity**: **Strong**

### Gaps & Risks
-   **Cross-Org Leakage**: While scoped, manual queries in future modules might miss `organizationId` filters if not strictly enforced by a repository layer (currently using direct Prisma calls in Services).
-   **Org Lifecycle**: No documented "Deactivate Organization" flow to suspend access immediately (e.g., for non-payment).
-   **Super Admin**: "ADMIN" role is per-organization. There is no clear "Platform Super Admin" to manage tenants in case of support issues.

### Required Actions
1.  **Backend**: Implement a custom Prisma Client Extension or Middleware to *force* `organizationId` on every query unless explicitly bypassed (Soft Delete / Scoping pattern).
2.  **Product**: Define "Suspended" state for Organizations and enforce it in `OrganizationGuard`.

### Priority
-   **High** (Safety net for data leakage is manual)

---

## 2. Authentication & Authorization

### Current State
-   **Implementation**: JWT-based stateless auth. `JwtStrategy` checks user existence and org membership.
-   **Roles**: `ADMIN`, `MANAGER`, `OPERATOR` implemented via `RolesGuard`.
-   **Maturity**: **MVP**

### Gaps & Risks
-   **Token Revocation**: No "Refresh Token" rotation or revocation mechanism visible in `auth` module. If a token is stolen, it's valid until expiry (`JWT_EXPIRES_IN`).
-   **Session Management**: No server-side session tracking to kill sessions remotely.
-   **Granularity**: Roles are coarse-grained. `MANAGER` has broad access. No specific permissions (e.g., "Can Edit Inventory" vs "Can View Inventory").

### Required Actions
1.  **Security**: Implement Refresh Token rotation with database persistence to allow revocation.
2.  **Backend**: Add `permissions` array to Roles for future-proofing granular access.

### Priority
-   **High** (Security standard for SaaS)

---

## 3. Order Lifecycle Management

### Current State
-   **Implementation**: State machine enforces transitions (`NEW` -> `RESERVED` -> `PAID`, etc.).
-   **Inventory Link**: Automatically reserves stock on order creation.
-   **Maturity**: **Strong**

### Gaps & Risks
-   **Idempotency**: `createFromChannel` has deduplication logic (`findFirst`), but race conditions exist if two webhooks arrive simultaneously (no unique constraint on `externalOrderId` at DB level seen in `schema.prisma` for *all* channels, though `unique([organizationId, channelId, externalOrderId])` exists).
-   **Editability**: No logic to handle "Order Edit" from Shopify (e.g., item added/removed after import).
-   **Data Race**: Two concurrent requests could reserve stock for the same order twice if the unique constraint isn't hit first.

### Required Actions
1.  **Backend**: Ensure `externalOrderId` unique constraint covers all ingestion paths.
2.  **Product**: Define behavior for "Order Edited" webhooks (currently unhandled/ignored).

### Priority
-   **Medium**

---

## 4. Inventory Management (CRITICAL)

### Current State
-   **Implementation**: Transactional updates using `prisma.$transaction`.
-   **Logic**: `reserveStockForOrder` checks availability before reserving.
-   **Maturity**: **MVP**

### Gaps & Risks
-   **Concurrency & Overselling**: `prisma.$transaction` provides atomicity but **NOT** automatic row locking (SELECT FOR UPDATE) in Prisma by default without explicit raw SQL or isolation level tuning. Under high load, two requests can read `quantityAvailable: 1`, both pass the check, and both decrement, leading to -1 (if no DB constraint prevents it). *Note: The code checks `newQuantityAvailable < 0` inside the transaction, which might abort the second one if the first commits, but race conditions in "Read-Modify-Write" are high risk without explicit locks.*
-   **Bulk Operations**: **MISSING**. No endpoint found for `POST /inventory/bulk-import` or CSV upload in `InventoryController`. This is a critical gap for merchant onboarding.
-   **Reconciliation**: No "Stock Take" feature to reconcile physical vs system stock (only absolute adjustments).

### Required Actions
1.  **Backend**: Implement **Optimistic Concurrency Control** (versioning) or **Pessimistic Locking** (`SELECT ... FOR UPDATE` via `prisma.$queryRaw`) for inventory updates.
2.  **Backend**: Build `POST /inventory/batch` endpoint for bulk updates (CSV/JSON).
3.  **Database**: Add Check Constraint `CHECK (quantity_available >= 0)` to Postgres for final safety net.

### Priority
-   **Critical** (Overselling risk + Missing onboarding feature)

---

## 5. Shipping & Carrier Integrations

### Current State
-   **Implementation**: Modular structure (`DhlService`, `FedexService`).
-   **Maturity**: **Partial**

### Gaps & Risks
-   **Failure Handling**: No clear "Circuit Breaker" or fallback if FedEx API is down. The system just errors out.
-   **Rate Limiting**: No logic to respect carrier rate limits.
-   **Label Voiding**: Code to "Cancel Shipment" exists, but need to verify if it actually calls the carrier to void the label (to get refund).

### Required Actions
1.  **Backend**: Wrap carrier calls in a Retry/Circuit Breaker pattern (e.g., using `cockatiel` or similar lib).
2.  **Backend**: Verify "Void Label" functionality implementation.

### Priority
-   **High**

---

## 6. Webhooks & Asynchronous Processing

### Current State
-   **Implementation**: `WebhooksController` pushes to Redis queue. Workers process asynchronously.
-   **Maturity**: **MVP**

### Gaps & Risks
-   **Signature Verification**: The code references `handleShopifyWebhook` but I need to confirm if `HMAC` signature verification is *actually enforced* before processing. If missing, anyone can inject fake orders.
-   **Dead Letter Queue**: Configuration shows `retryStrategy`, but need to confirm if a DLQ is set up for manual inspection of failed webhooks.
-   **Ordering**: Webhooks for the same order (Create -> Update) might be processed out of order if they end up in different concurrency slots.

### Required Actions
1.  **Security**: Enforce HMAC signature verification middleware for all webhook endpoints.
2.  **Backend**: Configure BullMQ Dead Letter Queue (DLQ) and UI to view it.

### Priority
-   **Critical** (Security vulnerability)

---

## 7. Data Model & Database Integrity

### Current State
-   **Implementation**: Normalized schema. UUIDs used.
-   **Maturity**: **Strong**

### Gaps & Risks
-   **Indexes**: Foreign keys have indexes (Prisma default behavior usually requires manual definition, code shows `@@index`). Good.
-   **Archival**: No strategy for archiving old orders. Table size will grow indefinitely.

### Required Actions
1.  **Infrastructure**: Plan for table partitioning or archival job for orders > 2 years.

### Priority
-   **Low** (Post-launch concern)

---

## 8. Performance & Scalability

### Current State
-   **Implementation**: Node.js event loop is good for I/O. Redis handles async load.
-   **Maturity**: **MVP**

### Gaps & Risks
-   **Inventory Hotspots**: High-velocity SKUs (e.g., "iPhone 15" on launch day) will cause database contention due to row locking/transactions.
-   **N+1 Queries**: `prisma` includes can cause massive joins or N+1 selects if not careful. `findAll` with `include` needs monitoring.

### Required Actions
1.  **Backend**: Load test "High Velocity SKU" scenario to determine max throughput per SKU.

### Priority
-   **Medium**

---

## 9. Observability & Operations

### Current State
-   **Implementation**: `IntegrationLog` table tracks external API calls. `StructuredLogger` exists.
-   **Maturity**: **Partial**

### Gaps & Risks
-   **Centralized Logging**: Logs go to stdout/files. In production, need aggregation (Datadog/CloudWatch) to correlate `traceId`.
-   **Metrics**: No Prometheus/StatsD metrics (e.g., "Orders per minute", "Webhook latency").
-   **Alerting**: No alerts defined for "Job Failure Rate > 1%".

### Required Actions
1.  **Ops**: Integrate a logging aggregator.
2.  **Backend**: Expose `/metrics` endpoint (Prometheus) for queue depth and API latency.

### Priority
-   **High**

---

## 10. Security

### Current State
-   **Implementation**: Helmet, CORS, ValidationPipe.
-   **Maturity**: **MVP**

### Gaps & Risks
-   **API Keys**: `configuration.ts` has defaults (`dev-secret-change-me`). If deployed without override, system is compromised.
-   **Rate Limiting**: **MISSING**. `main.ts` does not show `ThrottlerModule`. Public APIs (Login, Webhooks) are vulnerable to DDoS/Brute Force.

### Required Actions
1.  **Security**: Implement `ThrottlerModule` (Rate Limiting) globally.
2.  **Ops**: Ensure Secrets Management (Vault/AWS Secrets Manager) replaces env vars.

### Priority
-   **Critical**

---

## 11. Failure & Recovery Scenarios

### Current State
-   **Maturity**: **Weak**

### Gaps & Risks
-   **Inventory Drift**: If a job fails *after* reserving stock but *before* acknowledging the channel, stock is held indefinitely.
-   **Orphaned Data**: No "Cleanup Job" for stuck "PROCESSING" webhooks.

### Required Actions
1.  **Backend**: Implement "Stuck Job Watchdog" cron.
2.  **Ops**: Runbooks for "Manual Inventory Correction".

### Priority
-   **High**

---

## 12. Frontend Operational Robustness

### Current State
-   **Maturity**: **Partial**

### Gaps & Risks
-   **Error Visibility**: Does the UI show *why* an order sync failed? (Likely generic error).
-   **Bulk Feedback**: No UI for "Bulk Import Progress".

### Required Actions
1.  **Frontend**: Improve Error Boundaries to show specific API error messages to Operators.

### Priority
-   **Medium**

---

## 13. Deployment & Environments

### Current State
-   **Maturity**: **MVP**

### Gaps & Risks
-   **No Dockerfile**: Repo has `docker-compose` (for dependencies) but no production `Dockerfile` for the app itself.
-   **CI/CD**: No GitHub Actions workflows defined for build/deploy.

### Required Actions
1.  **Ops**: Create multi-stage `Dockerfile`.
2.  **Ops**: Build CI/CD pipeline.

### Priority
-   **Critical** (Cannot deploy)

---

## 14. Testing & Validation

### Current State
-   **Maturity**: **Strong** (Unit/E2E tests exist).

### Gaps & Risks
-   **Mock Reliance**: Integration tests rely heavily on mocks (`createMockShippingAccount`). Need "Live Sandbox" tests against real FedEx Sandbox.

### Required Actions
1.  **QA**: Run one manual pass against Real Carrier Sandboxes.

### Priority
-   **Medium**

---

## 15. Operational Readiness

### Current State
-   **Maturity**: **Not Implemented**

### Gaps & Risks
-   **Onboarding**: How does a new merchant get set up? (SQL inserts? Manual DB access?). No "Sign Up" flow for organizations detailed.
-   **Support**: No "Impersonate User" feature for support staff.

### Required Actions
1.  **Product**: Define the "Onboarding Runbook" (Manual is fine for MVP, but needs documentation).

### Priority
-   **Medium**

---

# Final Verdict

**Decision**: **NO-GO**

The platform is **NOT** ready for production. While the core domain logic (Orders, Inventory) is sound and well-tested, critical operational and security gaps prevent a safe launch.

## Top 5 Critical Blockers (Must Fix)
1.  **Inventory Bulk Import**: Merchants cannot onboard with zero inventory. Missing functionality.
2.  **Rate Limiting**: Public API is exposed to DDoS.
3.  **Deployment Artifacts**: No production Dockerfile or CI/CD pipeline.
4.  **Webhook Security**: Confirm and enforce HMAC signature verification.
5.  **Inventory Concurrency**: Add database constraints or locking to prevent overselling.

## Readiness Score
**65/100**

## Effort Estimate to Fix Criticals
**2-3 Weeks** (Backend + Ops focus)
