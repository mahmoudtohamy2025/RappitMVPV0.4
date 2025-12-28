# RAPPIT Production Execution Plan (OAuth Focus)

This document details the critical path to production, specifically focusing on the requirement that **all integrations must use OAuth-based authentication**. The current system contains mocks and stubs for integrations; these must be replaced with robust, secure, and multi-tenant OAuth implementations.

**Target Launch**: Production readiness for order fulfillment with secure integrations.

---

## 1. OAuth-Based Integrations (CRITICAL)

**Goal**: Replace mock connectors with real, secure OAuth flows for Shopify, WooCommerce, FedEx, and DHL.

### 1.1 Shopify OAuth Flow (Offline Access)
-   **Description**: Implement the "App Bridge" compatible OAuth 2.0 flow for Shopify.
    -   `GET /api/v1/auth/shopify/install`: Redirects to Shopify permission screen.
    -   `GET /api/v1/auth/shopify/callback`: Exchanges `code` for permanent offline `access_token`.
    -   Store `access_token` and `shop` in `Channel.config` (Encrypted).
-   **Reason**: API Keys are deprecated/insecure. OAuth is mandatory for public apps.
-   **Scope**: Backend / Frontend (Redirects).
-   **Dependencies**: `EncryptionService`.
-   **Acceptance Criteria**:
    -   User enters Shop URL -> Redirects to Shopify -> Approves -> Redirects back -> `Channel` created in DB.
    -   Token stored encrypted.
    -   `fetchOrders` uses the token successfully.
-   **Priority**: **Critical**
-   **Effort**: Medium (3-5 days)

### 1.2 WooCommerce OAuth 1.0a Flow
-   **Description**: Implement the standard WooCommerce Auth Endpoint flow.
    -   User inputs Store URL.
    -   Redirect to `{storeUrl}/wc-auth/v1/authorize`.
    -   Callback receives `consumer_key` and `consumer_secret`.
    -   Store keys encrypted in `Channel.config`.
-   **Reason**: Manual copy-pasting of keys is error-prone and less secure.
-   **Scope**: Backend.
-   **Dependencies**: `EncryptionService`.
-   **Acceptance Criteria**:
    -   Automated flow retrieves Read/Write keys.
    -   Keys stored encrypted.
-   **Priority**: **High**
-   **Effort**: Medium (3 days)

### 1.3 FedEx & DHL OAuth 2.0 (Client Credentials)
-   **Description**: Implement "Machine-to-Machine" OAuth for carriers.
    -   Store Client ID & Secret in `ShippingAccount.credentials` (Encrypted).
    -   Implement `TokenService` to exchange ID/Secret for Bearer Token.
    -   Cache Bearer Token in Redis with TTL (e.g., 55 minutes).
    -   Auto-refresh on 401 Unauthorized.
-   **Reason**: FedEx and DHL have moved to OAuth-based APIs. Legacy keys are being sunset.
-   **Scope**: Backend.
-   **Dependencies**: Redis.
-   **Acceptance Criteria**:
    -   System automatically fetches new token when cache expires.
    -   Rate limits respected.
-   **Priority**: **Critical**
-   **Effort**: Medium (4 days)

### 1.4 Encryption Service & Key Management
-   **Description**: Build a central `EncryptionService` using `AES-256-GCM`.
    -   Use a dedicated `ENCRYPTION_KEY` (distinct from JWT secret).
    -   Encrypt `Channel.config` and `ShippingAccount.credentials` on write.
    -   Decrypt on read (in Service layer only).
-   **Reason**: Storing OAuth tokens in plain text is a P0 security vulnerability.
-   **Scope**: Security / Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   DB values look like garbage text.
    -   Decrypted values work for API calls.
-   **Priority**: **Critical**
-   **Effort**: Small (2 days)

### 1.5 Integration Connection UI
-   **Description**: Build Frontend pages for "Connect Channel" and "Connect Carrier".
    -   Shopify: Input Shop URL -> "Connect" button (triggers OAuth).
    -   Status indicators: "Connected", "Error", "Needs Re-auth".
-   **Reason**: Non-technical users need a guided flow.
-   **Scope**: Frontend.
-   **Dependencies**: Backend OAuth endpoints.
-   **Acceptance Criteria**:
    -   Clean UX for connecting services.
    -   Error messages displayed if OAuth fails (e.g., "Access Denied").
-   **Priority**: **High**
-   **Effort**: Medium (3-5 days)

---

## 2. Inventory Operations

**Goal**: Ensure inventory data remains accurate during high volume.

### 2.1 Bulk Inventory Import with Validation
-   **Description**: Create `POST /inventory/bulk` endpoint.
    -   Accept CSV/JSON.
    -   Validate SKUs exist in Organization.
    -   Use transactions to update counts.
-   **Reason**: Merchants cannot onboard without bulk tools.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Importing 500 items works in < 5s.
    -   Invalid SKUs return a consolidated error report.
-   **Priority**: **High**
-   **Effort**: Medium (3 days)

### 2.2 Inventory Locking
-   **Description**: Implement database-level locking (Pessimistic or Optimistic) on `InventoryLevel` updates.
-   **Reason**: Prevent overselling when two orders hit simultaneously.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Concurrent updates to same SKU are serialized.
-   **Priority**: **Critical**
-   **Effort**: Small (2 days)

---

## 3. Order Lifecycle & Fulfillment

**Goal**: Robust order processing.

### 3.1 Idempotency for Webhooks
-   **Description**: Enforce unique constraint on `external_order_id` + `channel_id` + `organization_id`. Handle duplicate webhook events gracefully (ignore 2nd attempt).
-   **Reason**: Webhooks often fire multiple times.
-   **Scope**: Backend / Database.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Duplicate webhook returns 200 OK but does nothing.
-   **Priority**: **Medium**
-   **Effort**: Small (1 day)

---

## 4. Shipping & Carrier Integrations

**Goal**: Hardening carrier connections.

### 4.1 Carrier Circuit Breakers
-   **Description**: Wrap API calls to FedEx/DHL in a circuit breaker.
-   **Reason**: Prevent cascading failures if a carrier API goes down.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Stop calling Carrier after 5 consecutive timeouts.
-   **Priority**: **Medium**
-   **Effort**: Small (2 days)

---

## 5. Webhooks & Async Processing

**Goal**: Secure ingress.

### 5.1 Webhook Signature Verification
-   **Description**: Verify HMAC signatures for incoming webhooks using the `Channel.config` secret (obtained via OAuth).
-   **Reason**: Authenticity check.
-   **Scope**: Security.
-   **Dependencies**: OAuth implementation (to get the secret).
-   **Acceptance Criteria**:
    -   Invalid signature = 401 Unauthorized.
-   **Priority**: **Critical**
-   **Effort**: Small (2 days)

---

## 6. Multi-Tenancy & Access Control

**Goal**: Strict data isolation.

### 6.1 Global Scope Enforcement
-   **Description**: Middleware to enforce `organizationId` filter on all Prisma queries.
-   **Reason**: Prevent cross-tenant data leaks.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Querying without `organizationId` (except as Super Admin) throws error.
-   **Priority**: **Critical**
-   **Effort**: Medium (3 days)

---

## 7. Data Integrity & Database

**Goal**: Safe schema.

### 7.1 Database Constraints
-   **Description**: Add `CHECK (quantity_available >= 0)` to inventory table.
-   **Reason**: Last line of defense against overselling.
-   **Scope**: Database.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   DB rejects negative stock updates.
-   **Priority**: **High**
-   **Effort**: Small (1 day)

---

## 8. Observability & Auditability

**Goal**: Track OAuth lifecycle.

### 8.1 OAuth Audit Logging
-   **Description**: Log events: `CHANNEL_CONNECTED`, `TOKEN_REFRESHED`, `CHANNEL_DISCONNECTED`.
-   **Reason**: Debugging connection issues.
-   **Scope**: Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Logs stored in `IntegrationLog` or separate audit table.
-   **Priority**: **Medium**
-   **Effort**: Small (1 day)

---

## 9. Security Hardening

**Goal**: Protect secrets.

### 9.1 Secret Management
-   **Description**: Move all hardcoded secrets (AWS keys, DB passwords, Encryption Keys) to Environment Variables / Secrets Manager.
-   **Reason**: Hardcoded secrets are a major risk.
-   **Scope**: Infrastructure / Ops.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   No secrets in source code.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 10. Frontend Integration UX

**Goal**: Usability.

### 10.1 OAuth Error Handling
-   **Description**: UI to handle OAuth redirect errors (e.g., user denied permission) and show helpful messages.
-   **Reason**: Non-technical users need guidance.
-   **Scope**: Frontend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   User sees "Connection Failed: You denied permission" instead of generic error.
-   **Priority**: **Medium**
-   **Effort**: Small (2 days)

---

## 11. Deployment & Infrastructure

**Goal**: Safe environments.

### 11.1 OAuth Callback Config
-   **Description**: Configure different Callback URLs for Dev (`localhost`), Staging, and Prod in OAuth Providers (Shopify/FedEx dashboards).
-   **Reason**: Isolate environments.
-   **Scope**: Ops.
-   **Dependencies**: Access to Provider Dashboards.
-   **Acceptance Criteria**:
    -   Dev redirects to localhost.
    -   Prod redirects to production domain.
-   **Priority**: **Critical**
-   **Effort**: Small (1 day)

---

## 12. Testing & Validation

**Goal**: Verify flows.

### 12.1 Integration Tests for OAuth
-   **Description**: Write tests for Token Refresh logic (mocking expiration) and Encryption Service.
-   **Reason**: Ensure tokens don't silently expire.
-   **Scope**: QA / Backend.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Test: Token expired -> Call Refresh -> Retry API call -> Success.
-   **Priority**: **High**
-   **Effort**: Medium (3 days)

---

## 13. Operational Readiness

**Goal**: Support.

### 13.1 Connection Debugging Playbook
-   **Description**: Runbook for support staff to check if a Channel's token is valid or revoked.
-   **Reason**: Fast resolution of "Sync Stopped" tickets.
-   **Scope**: Ops / Support.
-   **Dependencies**: None.
-   **Acceptance Criteria**:
    -   Documented SQL/API call to check token status.
-   **Priority**: **Medium**
-   **Effort**: Small (1 day)

---

# Pre-Launch Checklist (OAuth Criticals)

1.  [ ] **OAuth**: Shopify "App Bridge" flow implemented & tested.
2.  [ ] **OAuth**: WooCommerce Auth flow implemented & tested.
3.  [ ] **OAuth**: FedEx/DHL Client Credentials flow (with Refresh) implemented.
4.  [ ] **Security**: Encryption Service active for all tokens.
5.  [ ] **Security**: HMAC Verification active for webhooks.
6.  [ ] **Security**: All secrets removed from code / repo.
7.  [ ] **Frontend**: "Connect" buttons trigger correct OAuth flows.

# Estimates

**Time to Production**:
-   **Optimistic**: 3 Weeks (If OAuth approvals from platforms are fast).
-   **Realistic**: 4-5 Weeks (Account for rigorous testing of token refresh logic).

**Statement of Readiness**:
> "Once the OAuth flows are implemented and the Token Encryption is active, RAPPIT will meet the security and usability standards required for a multi-tenant production launch."
