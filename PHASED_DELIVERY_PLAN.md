# RAPPIT Production Delivery Plan

**Role**: Principal Engineer & Delivery Owner
**Context**: Transitioning from MVP to Production
**Total Timeline**: 8 Weeks

This document outlines the strict, sequential execution plan required to launch RAPPIT safely. It prioritizes security foundations, data integrity, and the mandatory OAuth architecture before feature completeness.

---

## PHASE 1 — Foundations & Security Hardening
**Timeline**: Week 1

### 1. Purpose
Establish a secure, deployable baseline. We cannot build secure integrations or reliable inventory on a shaky infrastructure. This phase closes the most critical security vulnerabilities and enables safe deployment.

### 2. Modules Included
-   **Infrastructure**: Deployment & Config
-   **Security**: Rate Limiting, Secrets, Encryption
-   **Core**: Multi-tenancy enforcement

### 3. Key Work Items
-   **Infrastructure**:
    -   Create production multi-stage `Dockerfile`.
    -   Set up basic CI/CD pipeline (Build & Test).
-   **Security**:
    -   Implement `EncryptionService` (AES-256-GCM) for future OAuth token storage.
    -   Migrate all hardcoded secrets to Environment Variables / Secrets Manager.
    -   Implement global API Rate Limiting (`@nestjs/throttler`) for public endpoints (Auth, Webhooks).
-   **Multi-Tenancy**:
    -   Implement Global Prisma Middleware to enforce `organizationId` scoping on all queries by default.

### 4. Dependencies
-   None (Greenfield for Ops/Security).

### 5. Exit Criteria
-   [ ] Production build passes in CI.
-   [ ] No secrets exist in the codebase.
-   [ ] Public API endpoints return 429 when stressed.
-   [ ] Database queries fail if `organizationId` is missing (verified by test).

---

## PHASE 2 — Inventory Reliability (The Trust Layer)
**Timeline**: Weeks 2-3

### 1. Purpose
Inventory accuracy is the primary value proposition. We must prevent overselling and enable merchants to actually get their data into the system. Without this, we have no product.

### 2. Modules Included
-   **Inventory**: Import, Updates, Locking
-   **Database**: Constraints
-   **Frontend**: Inventory UI

### 3. Key Work Items
-   **Database Safety**:
    -   Add `CHECK (quantity_available >= 0)` constraint to `inventory_levels` table.
-   **Concurrency**:
    -   Implement Pessimistic Locking (`SELECT FOR UPDATE`) or Optimistic Versioning in `adjustStock` and `reserveStock` methods.
-   **Bulk Operations**:
    -   Build `POST /inventory/bulk` endpoint (Transactional, Validation-heavy).
    -   Build Frontend UI for CSV Upload and error reporting.
-   **UX**:
    -   Update Inventory UI to handle specific API errors (e.g., "Locked", "Insufficient Stock") gracefully.

### 4. Dependencies
-   Phase 1 (Global Scoping Middleware ensures imports don't leak data).

### 5. Exit Criteria
-   [ ] Automated load test proves no overselling occurs under high concurrency.
-   [ ] 1,000 SKU CSV import completes successfully in < 5 seconds.
-   [ ] Database rejects negative stock updates.

**MILESTONE**: *System is Internally Usable (Admins can set up valid tenant data).*

---

## PHASE 3 — Secure Integrations (OAuth)
**Timeline**: Weeks 4-5

### 1. Purpose
Replace mock/insecure connections with production-grade OAuth flows. This enforces the architectural mandate: "OAuth First".

### 2. Modules Included
-   **Integrations**: Shopify, WooCommerce, FedEx, DHL
-   **Frontend**: Connection UI

### 3. Key Work Items
-   **Sales Channels**:
    -   Implement Shopify OAuth 2.0 (Offline Access) flow & token encryption.
    -   Implement WooCommerce OAuth 1.0a flow & token encryption.
    -   Build "Connect Channel" UI with redirect handling.
-   **Carriers**:
    -   Implement FedEx & DHL Client Credentials flow.
    -   Implement `TokenService` with Redis caching and auto-refresh logic.
    -   Build "Connect Carrier" UI.
-   **Audit**:
    -   Log `CHANNEL_CONNECTED` and `TOKEN_REFRESHED` events.

### 4. Dependencies
-   Phase 1 (EncryptionService, Secrets Management).

### 5. Exit Criteria
-   [ ] Connecting a real Shopify store stores an *encrypted* token in the DB.
-   [ ] Connecting FedEx retrieves a Bearer token and caches it.
-   [ ] Refresh logic handles expired tokens automatically without user intervention.

---

## PHASE 4 — Order Ingestion & Resilience
**Timeline**: Week 6

### 1. Purpose
Now that channels are connected securely, we must handle the influx of data without corruption or loss.

### 2. Modules Included
-   **Webhooks**: Verification, Queueing
-   **Orders**: Idempotency, Editing

### 3. Key Work Items
-   **Security**:
    -   Implement HMAC Signature Verification middleware for all incoming webhooks (using secrets from Phase 3).
-   **Reliability**:
    -   Configure Dead Letter Queue (DLQ) in BullMQ for failed webhooks.
    -   Enforce Idempotency: Add Unique Constraint on `(org_id, channel_id, external_order_id)`.
    -   Update ingestion logic to handle duplicates gracefully.
-   **Edge Cases**:
    -   Implement `orders/updated` handler to adjust inventory if items changed post-purchase.

### 4. Dependencies
-   Phase 3 (Need OAuth secrets to verify HMAC).
-   Phase 2 (Need robust inventory locking for order reservations).

### 5. Exit Criteria
-   [ ] Fake webhooks (invalid signature) are rejected with 401.
-   [ ] Sending the same order webhook 10 times results in exactly 1 DB record.
-   [ ] Failed jobs appear in DLQ and can be retried.

---

## PHASE 5 — Fulfillment & Shipping Hardening
**Timeline**: Week 7

### 1. Purpose
Ensure physical operations don't halt when external partners blink.

### 2. Modules Included
-   **Shipping**: Labels, Tracking, Resilience

### 3. Key Work Items
-   **Resilience**:
    -   Wrap Carrier API calls in Circuit Breakers (stop calling if FedEx is down).
-   **Correctness**:
    -   Verify "Void Label" logic calls carrier API to prevent merchant billing issues.
    -   Implement Polling or Webhook handler for Tracking Updates (using Phase 3 tokens).

### 4. Dependencies
-   Phase 3 (Carrier OAuth tokens).

### 5. Exit Criteria
-   [ ] System handles simulated FedEx downtime gracefully (UI shows "Service Temporary Unavailable").
-   [ ] Canceling a shipment in UI voids the label at the carrier.

---

## PHASE 6 — Operational Readiness & Launch
**Timeline**: Week 8

### 1. Purpose
Prepare the team and the system for day-one reality. Observability and procedures.

### 2. Modules Included
-   **Ops**: Logging, Monitoring
-   **Documentation**: Runbooks

### 3. Key Work Items
-   **Observability**:
    -   Configure JSON Structured Logging & ship to aggregator (Datadog/CloudWatch).
    -   Expose `/metrics` endpoint for queue depth monitoring.
-   **Procedures**:
    -   Create "Tenant Onboarding" Runbook (SQL scripts / Admin API steps).
    -   Create "Token Debugging" Runbook for support.
-   **Validation**:
    -   Perform one full End-to-End Rehearsal: Onboard Org -> Connect Shopify (OAuth) -> Import Inventory (Bulk) -> Sync Order -> Print Label -> Void Label.

### 4. Dependencies
-   All previous phases.

### 5. Exit Criteria
-   [ ] Logs are searchable by `orderId` in the aggregator.
-   [ ] Support team can explain how to debug a failed webhook.
-   [ ] E2E Rehearsal passes without critical errors.

**MILESTONE**: *System is Production Ready for External Merchants.*

---

# Execution Summary

1.  **Total Time to Production**: 8 Weeks
2.  **First Internally Usable System**: End of **Phase 2** (Week 3) - *Admins can manage inventory safely.*
3.  **External Merchant Readiness**: End of **Phase 6** (Week 8) - *Integrations secure, Ops ready.*

**Final Statement**:
"After completing these 6 phases in order, RAPPIT is production-ready. Any deviation from this order introduces security risks (missing OAuth/Secrets) or data integrity risks (missing Locking/Idempotency)."
