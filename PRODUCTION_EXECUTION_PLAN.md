# RAPPIT Production Execution Plan

This document details the work required to bridge the gap between the current MVP state and a safe, production-ready release. It serves as the primary roadmap for the engineering and operations teams.

**Total Estimated Work**: 3-4 Weeks
**Target Launch Date**: [TBD based on start date]

---

## 1. Inventory Operations (CRITICAL)

**Goal**: Enable merchants to onboard and trust the system to prevent overselling.

### 1.1 Implement Bulk Inventory Import
-   **Description**: Build a `POST /inventory/bulk` endpoint accepting CSV/JSON. Logic must parse, validate, and upsert `InventoryItem` records transactionally.
-   **Reason**: Merchants cannot onboard manually item-by-item. Blocking for launch.
-   **Scope**: Backend (API), Frontend (UI for upload).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   API accepts CSV with headers `sku`, `quantity`, `warehouse_code`.
    -   Validates SKUs exist in `Organization`.
    -   Updates `quantityAvailable` and `quantityTotal`.
    -   Returns summary of success/failure counts.
    -   Handles 1,000+ items in < 5 seconds.
-   **Priority**: **Critical**
-   **Effort**: Medium (3-5 days)

### 1.2 Inventory Concurrency Locking
-   **Description**: Add Pessimistic Locking (`SELECT FOR UPDATE`) or Optimistic Versioning to `adjustStock` and `reserveStock` methods.
-   **Reason**: Prevents race conditions where two orders simultaneous reserve the last item.
-   **Scope**: Backend (Database/Prisma).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Concurrent requests for the same SKU result in serial execution or strictly enforced errors.
    -   DB Constraint `CHECK (quantity_available >= 0)` added to migration.
-   **Priority**: **Critical**
-   **Effort**: Small (2 days)

---

## 2. Order Lifecycle & Fulfillment

**Goal**: Ensure data accuracy during high-volume ingestion and edge cases.

### 2.1 Enforce Import Idempotency
-   **Description**: Add a database unique constraint on `orders(organization_id, channel_id, external_order_id)`. Update ingestion logic to handle "Unique Constraint Violation" gracefully (ignore or update).
-   **Reason**: Webhooks often fire multiple times. Duplicate orders destroy trust.
-   **Scope**: Backend (Schema + Logic).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Sending the same webhook payload 5 times results in exactly 1 order in the DB.
    -   Constraint violation handled without crashing the worker.
-   **Priority**: **High**
-   **Effort**: Small (1 day)

### 2.2 Handle "Order Edited" Webhooks
-   **Description**: Implement handler for Shopify `orders/updated` to check for quantity changes.
-   **Reason**: Customers often change orders post-purchase. System must reflect this or inventory will drift.
-   **Scope**: Backend (Webhooks Module).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   If an item quantity increases in Shopify, Rappit reserves more stock.
    -   If an item is removed, Rappit releases stock.
-   **Priority**: **Medium**
-   **Effort**: Medium (3 days)

---

## 3. Shipping & Carrier Integrations

**Goal**: Ensure operations don't stop when carriers have hiccups.

### 3.1 Carrier Circuit Breakers
-   **Description**: Wrap `DhlService` and `FedexService` calls in a circuit breaker (e.g., using `cockatiel`).
-   **Reason**: FedEx API downtime shouldn't crash the entire job queue.
-   **Scope**: Backend (Integrations).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   After 5 consecutive failures, the system stops calling FedEx for 60 seconds.
    -   Fast failure returned to UI instead of long timeout.
-   **Priority**: **High**
-   **Effort**: Small (2 days)

### 3.2 Label Generation Hardening
-   **Description**: Ensure "Void Label" (Cancel Shipment) actually calls the carrier API to cancel the label.
-   **Reason**: Merchants get charged for unused labels if not voided within a window.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Clicking "Cancel Shipment" updates internal status AND receives success from FedEx/DHL API.
-   **Priority**: **High**
-   **Effort**: Small (2 days)

---

## 4. Webhooks & Async Processing

**Goal**: Secure the ingress and ensure no data is lost.

### 4.1 HMAC Signature Verification
-   **Description**: Implement middleware to verify `X-Shopify-Hmac-Sha256` (and equivalent for Woo) headers against the stored `channel.secret`.
-   **Reason**: Prevents attackers from injecting fake orders.
-   **Scope**: Security / Backend.
-   **Dependencies**: Access to real secrets.
-   **Acceptance Criteria**:
    -   Webhook with valid signature is processed.
    -   Webhook with modified payload or invalid signature returns 401/403.
-   **Priority**: **Critical**
-   **Effort**: Small (2 days)

### 4.2 Dead Letter Queue (DLQ) Configuration
-   **Description**: Configure BullMQ to move failed jobs to a `failed` queue and expose a basic UI (or API) to retry them.
-   **Reason**: "Poison pill" webhooks shouldn't clog the queue, but shouldn't be lost either.
-   **Scope**: Backend / Ops.
-   **Dependencies**: Redis.
-   **Acceptance Criteria**:
    -   Job failing 3 times moves to DLQ.
    -   Operator can trigger "Retry" for jobs in DLQ.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 5. Multi-Tenancy & Access Control

**Goal**: Guarantee isolation and access safety.

### 5.1 Global Organization Scope Enforcement
-   **Description**: Implement a Prisma Middleware or Client Extension to auto-inject `where: { organizationId }` into queries.
-   **Reason**: Manual scoping in every Service method is error-prone. One missed line causes data leak.
-   **Scope**: Backend (Core).
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   `prisma.order.findMany()` automatically filters by the current context's organization.
    -   Explicit "Bypass" required for Admin tools.
-   **Priority**: **High**
-   **Effort**: Medium (3 days)

---

## 6. Data Integrity & Database

**Goal**: Future-proof the data layer.

### 6.1 Database Check Constraints
-   **Description**: Add SQL migration for `CHECK (quantity_available >= 0)` on `inventory_levels`.
-   **Reason**: Final safety net against bugs causing negative stock.
-   **Scope**: Database.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   `UPDATE inventory SET available = -5` throws database error.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 7. Observability & Auditability

**Goal**: See what's happening in production.

### 7.1 Structured Logging Aggregation
-   **Description**: Configure `winston` or `pino` to output JSON logs. Ship to aggregator (e.g., Datadog/CloudWatch) via agent.
-   **Reason**: Grepping text logs in a container is impossible at scale.
-   **Scope**: Ops / Backend.
-   **Dependencies**: Log provider account.
-   **Acceptance Criteria**:
    -   Logs appear in dashboard searchable by `orderId` or `traceId`.
-   **Priority**: **High**
-   **Effort**: Small (2 days)

### 7.2 API Rate Limiting
-   **Description**: Add `@nestjs/throttler` to `AppModule`. Limit public endpoints (Auth, Webhooks) strictly.
-   **Reason**: Prevent DDoS and Brute Force attacks.
-   **Scope**: Security / Backend.
-   **Dependencies**: Redis (for storage).
-   **Acceptance Criteria**:
    -   Exceeding 60 req/min returns 429 Too Many Requests.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 8. Frontend Operational Readiness

**Goal**: Empower operators to self-serve.

### 8.1 Improved Error Feedback
-   **Description**: Update UI handling of 400/500 errors to show the `message` field from the API (e.g., "Insufficient Stock") instead of "Something went wrong".
-   **Reason**: Reduces support tickets when operators make valid mistakes.
-   **Scope**: Frontend.
-   **Dependencies**: Backend Error Filter (Done).
-   **Acceptance Criteria**:
    -   Triggering an inventory error displays the exact reason in a Toast notification.
-   **Priority**: **Medium**
-   **Effort**: Small (2 days)

---

## 9. Deployment & Infrastructure

**Goal**: Deploy safely and repeatedly.

### 9.1 Production Dockerfile
-   **Description**: Create a multi-stage `Dockerfile` (Build -> Run) for the NestJS API. Optimize image size (Alpine).
-   **Reason**: Current `docker-compose` is for dev only (mounts volumes). Prod needs immutable artifact.
-   **Scope**: Ops.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   `docker build` passes.
    -   Image size < 300MB.
    -   Starts successfully without volume mounts.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

### 9.2 Secrets Management
-   **Description**: Remove defaults from `configuration.ts`. Configure app to read from injected secrets (AWS Parameter Store / K8s Secrets).
-   **Reason**: Hardcoded "dev-secret" is a major security hole.
-   **Scope**: Ops.
-   **Dependencies**: Infra provider.
-   **Acceptance Criteria**:
    -   App fails to start if `JWT_SECRET` is missing (no default fallback in prod).
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 10. Operational Readiness

**Goal**: Prepare the humans.

### 10.1 Onboarding Runbook
-   **Description**: Document the exact SQL queries or API calls needed to create a new Organization, User, and Channel.
-   **Reason**: No UI for "Sign Up" exists yet. Sales/Support need a way to board customers.
-   **Scope**: Product / Ops.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   A junior engineer can onboard a new tenant in < 15 minutes using the doc.
-   **Priority**: **High**
-   **Effort**: Small (1 day)

---

# Consolidated Pre-Launch Checklist (Critical Only)

1.  [ ] **Security**: Rate Limiting (`ThrottlerModule`) enabled.
2.  [ ] **Security**: HMAC Verification enabled for Webhooks.
3.  [ ] **Security**: Production Secrets configured (no defaults).
4.  [ ] **Data**: Bulk Inventory Import API active.
5.  [ ] **Data**: Inventory Concurrency Locking / DB Constraints active.
6.  [ ] **Infra**: Production Dockerfile built and tested.
7.  [ ] **Ops**: Dead Letter Queue configured for Webhooks.

---

# Estimates

**Time to Production**:
-   **Best Case**: 3 Weeks (Focused team, no major bugs found).
-   **Worst Case**: 5 Weeks (Integration issues with carriers, load testing failures).

**Statement of Readiness**:
> "If the 7 items in the Pre-Launch Checklist are completed and verified, RAPPIT is production-ready for initial fulfillment operations."
