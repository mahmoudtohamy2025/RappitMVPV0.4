# Rappit System Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Project Structure](#3-project-structure)
4. [Core Domain Model](#4-core-domain-model)
5. [Data Flow](#5-data-flow)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [User & Access Model](#7-user--access-model)
8. [Feature-by-Feature Breakdown](#8-feature-by-feature-breakdown)
9. [Integrations](#9-integrations)
10. [Background Jobs & Async Processing](#10-background-jobs--async-processing)
11. [Error Handling & Reliability](#11-error-handling--reliability)
12. [Observability & Logging](#12-observability--logging)
13. [Frontend / Client Applications](#13-frontend--client-applications)
14. [Database & Persistence](#14-database--persistence)
15. [Configuration & Environments](#15-configuration--environments)
16. [Deployment & Operations](#16-deployment--operations)
17. [Testing Strategy](#17-testing-strategy)
18. [Security Review](#18-security-review)
19. [Known Limitations & Technical Debt](#19-known-limitations--technical-debt)
20. [Production Readiness Assessment](#20-production-readiness-assessment)
21. [Appendix](#21-appendix)

---

## 1. System Overview

**Rappit** is a multi-tenant SaaS operations platform designed for e-commerce businesses in the MENA region. It serves as a centralized hub for managing:

-   **Orders**: Aggregating orders from multiple sales channels.
-   **Inventory**: Tracking stock levels across warehouses.
-   **Shipping**: Generating labels and tracking shipments with various carriers.

The system is built to support multiple organizations (tenants), each capable of connecting multiple sales channels and shipping carrier accounts.

### Primary Users
-   **Organization Admins**: Manage settings, users, and billing.
-   **Operations Managers**: Oversee order fulfillment and inventory.
-   **Warehouse Staff**: Pick, pack, and ship items.

### Core Problems Solved
-   Fragmented operations across different e-commerce platforms (Shopify, WooCommerce).
-   Manual data entry for shipping labels (DHL, FedEx).
-   Lack of centralized inventory visibility.

---

## 2. Architecture Overview

Rappit employs a **modern microservices-ready architecture** centered around a monolithic NestJS backend and a Next.js frontend.

### High-Level Architecture

1.  **Backend API (NestJS)**:
    -   Serves as the core logic engine.
    -   Exposes a RESTful API (default prefix `api/v1`).
    -   Manages database interactions via Prisma ORM.
    -   Handles asynchronous tasks (webhooks, sync) via BullMQ and Redis.

2.  **Frontend Application (Next.js)**:
    -   Located in `src/next-app`.
    -   Built with Next.js 14 App Router.
    -   Handles authentication (SSR mediated) and user interface.
    -   Supports RTL (Right-to-Left) layout natively.

3.  **Prototype/Dashboard UI (Vite)**:
    -   Located in `src/App.tsx`.
    -   A lightweight React Single Page Application (SPA).
    -   Likely serves as a development prototype or alternative dashboard.

### Key Architectural Decisions
-   **Multi-Tenancy**: Implemented at the database level. Almost all entities (`Order`, `Product`, `Customer`) are scoped by `organizationId`.
-   **Async Processing**: Heavy lifting (e.g., syncing orders, processing webhooks) is offloaded to background workers using Redis queues (`src/src/workers`).
-   **Hexagonal-ish Structure**: Clear separation between `modules` (domain logic), `integrations` (external adapters), and `common` (shared infrastructure).

---

## 3. Project Structure

The repository is a monorepo-style setup containing both backend and frontend code.

### Repository Layout

```text
.
├── src/
│   ├── src/                 # Backend Application (NestJS)
│   │   ├── app.module.ts    # Main application module
│   │   ├── main.ts          # Entry point
│   │   ├── common/          # Shared guards, decorators, filters
│   │   ├── config/          # Configuration loading
│   │   ├── modules/         # Domain modules (Orders, Inventory, etc.)
│   │   ├── integrations/    # External service adapters (Shopify, DHL, etc.)
│   │   ├── queues/          # Queue definitions
│   │   └── workers/         # Background job processors
│   │
│   ├── next-app/            # Frontend Application (Next.js)
│   │   ├── app/             # App Router pages and API routes
│   │   ├── components/      # React components
│   │   ├── lib/             # Utilities and fetchers
│   │   └── middleware.ts    # Auth protection middleware
│   │
│   ├── prisma/              # Database Schema & Migrations
│   │   └── schema.prisma    # Main data model definition
│   │
│   └── App.tsx              # Legacy/Prototype React App
```

### Entry Points
-   **Backend**: `src/src/main.ts` - Bootstraps the NestJS server.
-   **Next.js Frontend**: `src/next-app/app/page.tsx` - Main dashboard entry.
-   **Vite Frontend**: `src/main.tsx` - Bootstraps the Vite React app.

---

## 4. Core Domain Model

The domain model is defined in `src/prisma/schema.prisma` and reflects a relational database structure (PostgreSQL).

### Main Entities

1.  **Organization & User**:
    -   `Organization`: The tenant. Holds all business data.
    -   `User`: Global entity, linked to organizations via `UserOrganization` (many-to-many) with roles.

2.  **Sales Channels**:
    -   `Channel`: Represents a connection to an external store (Shopify, WooCommerce).
    -   `ChannelType`: Enum (`SHOPIFY`, `WOOCOMMERCE`).

3.  **Products & Inventory**:
    -   `Product` / `SKU`: Internal representation of items.
    -   `Warehouse`: Physical locations.
    -   `InventoryLevel`: Quantity of a SKU at a specific Warehouse.
    -   `InventoryReservation`: Temporary hold on stock for Orders.

4.  **Orders**:
    -   `Order`: The central transactional entity.
    -   `OrderItem`: Line items within an order.
    -   `OrderStatus`: State machine (`NEW`, `PAID`, `READY_TO_SHIP`, `SHIPPED`, etc.).

5.  **Shipping**:
    -   `ShippingAccount`: Credentials for carriers (DHL, FedEx).
    -   `Shipment`: Represents a physical package/label.
    -   `ShipmentTracking`: History of carrier updates.

### Key Relationships
-   **Organization Scoping**: `Organization` is the root of the hierarchy. Access to `Order`, `Product`, etc., is guarded by `organizationId`.
-   **Inventory Link**: `Order` -> `OrderItem` -> `SKU` -> `InventoryLevel`.

---

## 5. Data Flow

### Order Import Flow
1.  **Trigger**: Webhook from Channel (e.g., Shopify `orders/create`) or Manual Sync.
2.  **Ingestion**:
    -   `WebhooksController` receives the payload.
    -   Pushes event to `WebhookQueue` via `WebhooksService`.
3.  **Processing**:
    -   `WebhookProcessor` worker picks up the job.
    -   Calls `OrdersService.createFromChannel()`.
    -   Maps external data to internal `Order` / `OrderItem` models.
    -   Finds or creates `Customer`.
4.  **Persistence**: Saved to Postgres `orders` table.

### Shipping Flow
1.  **Trigger**: User requests a shipping label for an `Order`.
2.  **Processing**:
    -   `ShippingService` validates the request.
    -   Selects the appropriate `ShippingAccount` (Carrier).
    -   Calls specific integration (e.g., `FedexIntegrationService`).
3.  **External Call**: Request sent to Carrier API (e.g., FedEx `Create Shipment`).
4.  **Result**:
    -   Label image and Tracking Number returned.
    -   `Shipment` record created in DB.
    -   `Order` status updated to `READY_TO_SHIP` or `SHIPPED`.

---

## 6. Authentication & Authorization

The system implements a secure, token-based authentication mechanism.

### Authentication Mechanisms
-   **Method**: JSON Web Tokens (JWT).
-   **Strategy**: `JwtStrategy` (using `passport-jwt`).
-   **Token Extraction**: Bearer Token from Authorization Header (`ExtractJwt.fromAuthHeaderAsBearerToken()`).
-   **Verification**: Validates signature using `JWT_SECRET`. Checks `sub` (User ID) and `orgId` (Organization ID).

### Authorization & Access Control
-   **Global Guards**: `JwtAuthGuard` is applied globally (except for `@Public()` routes).
-   **Role-Based Access Control (RBAC)**:
    -   `RolesGuard` enforces permissions based on `UserRole` (`ADMIN`, `MANAGER`, `OPERATOR`).
    -   Applied via decorators: `@Roles(UserRole.ADMIN)`.
-   **Organization Scoping**:
    -   `OrganizationGuard`: Ensures the user has a valid membership in the target organization.
    -   Controllers use `@CurrentOrganization()` to scope DB queries automatically.

---

## 7. User & Access Model

The access model is designed for multi-tenancy, allowing a single user to belong to multiple organizations with different roles.

### User Lifecycle
1.  **Registration**: Users sign up and create an Organization or are invited to an existing one.
2.  **Organization Membership**: Managed via the `UserOrganization` join table.
3.  **Context Switching**: Users select an active organization context. The JWT is issued for a specific `organizationId`. To switch organizations, the user must re-authenticate (or exchange tokens) for the new context.

### Roles and Permissions
-   **ADMIN**: Full access to all resources within the organization.
-   **MANAGER**: Can manage operations (Orders, Inventory) but restricted from sensitive settings (Billing, Users).
-   **OPERATOR**: Read-write access to day-to-day operations; no delete privileges (typically).

---

## 8. Feature-by-Feature Breakdown

### 8.1 Order Management
-   **Functionality**: View, filter, and process orders.
-   **Trigger**: Inbound webhook, manual creation, or sync job.
-   **Code Location**: `src/src/modules/orders`.
-   **Key Components**: `OrdersService`, `OrdersController`.
-   **Status**: Fully implemented.

### 8.2 Inventory Management
-   **Functionality**: Track stock across warehouses, manage reservations.
-   **Trigger**: Order creation (reserves stock), Shipment (deducts stock), Manual adjustment.
-   **Code Location**: `src/src/modules/inventory`.
-   **Status**: Implemented with support for multi-warehouse.

### 8.3 Shipping & Fulfillment
-   **Functionality**: Rate shopping, Label generation, Tracking.
-   **Trigger**: User action on an Order ("Create Shipment").
-   **Code Location**: `src/src/modules/shipping`.
-   **Status**: Core logic exists; integrates with DHL and FedEx.

### 8.4 Multi-Channel Sync
-   **Functionality**: Pulling products/orders from external channels.
-   **Trigger**: Scheduled Cron jobs or Webhooks.
-   **Code Location**: `src/src/modules/channels`.
-   **Status**: Framework in place; specific channel logic in `integrations/`.

---

## 9. Integrations

The system is designed with a plugin-like architecture for integrations.

### 9.1 Shopify
-   **Type**: Sales Channel.
-   **Status**: Implemented (`ShopifyService`, `ShopifyController`).
-   **Features**: Order Import, Inventory Sync, Webhook handling (`orders/create`).
-   **Auth**: OAuth / Access Token.

### 9.2 WooCommerce
-   **Type**: Sales Channel.
-   **Status**: Implemented (`WooCommerceService`).
-   **Features**: OAuth 1.0a support, Webhook handling.

### 9.3 DHL
-   **Type**: Shipping Carrier.
-   **Status**: Implemented (`DhlService`).
-   **Features**: Shipment creation, Rate retrieval.

### 9.4 FedEx
-   **Type**: Shipping Carrier.
-   **Status**: Implemented (`FedexService`).
-   **Features**: Authentication (OAuth), Label generation.

---

## 10. Background Jobs & Async Processing

Heavy operations are decoupled from the HTTP request cycle using Redis queues.

### Queue System
-   **Technology**: BullMQ backed by Redis.
-   **Configuration**: Defined in `src/src/queues/queues.ts`.

### Job Types & Workers
1.  **Webhook Processing**:
    -   **Queue**: `webhooks`
    -   **Worker**: `WebhookProcessor`
    -   **Responsibility**: Parse raw webhook payloads and trigger domain actions (e.g., `createOrder`).

2.  **Order Sync**:
    -   **Queue**: `orders`
    -   **Processor**: `OrdersProcessor`
    -   **Responsibility**: Bulk sync of orders from channels.

3.  **Inventory Sync**:
    -   **Queue**: `inventory`
    -   **Processor**: `InventoryProcessor`
    -   **Responsibility**: Pushing stock updates to channels.

4.  **Shipping Tasks**:
    -   **Queue**: `shipping`
    -   **Processor**: `ShippingProcessor`
    -   **Responsibility**: Async label generation or tracking updates.

---

## 11. Error Handling & Reliability

The system uses a centralized error handling strategy to ensure consistent API responses and system stability.

### Global Error Filter
-   **Implementation**: `HttpExceptionFilter` in `src/src/common/filters/http-exception.filter.ts`.
-   **Behavior**: Catches `HttpException` and standardizes the response JSON structure (timestamp, path, message, status).

### Reliability Mechanisms
-   **Queue Retries**: BullMQ is configured (implied by worker setup) to retry failed jobs.
-   **Database Transactions**: Prisma is used, allowing for transactional integrity in complex operations (e.g., Order + Inventory updates).

---

## 12. Observability & Logging

### Logging
-   **Service**: `IntegrationLoggingService` and `StructuredLogger`.
-   **Interceptor**: `LoggingInterceptor` (`src/src/common/interceptors/logging.interceptor.ts`) logs incoming requests and execution time.
-   **Structured Logs**: JSON-formatted logs suitable for aggregation.

### Audit Logs
-   **Database**: The `IntegrationLog` entity (in `schema.prisma`) records outbound/inbound API calls to external systems (Shopify, DHL, etc.), capturing request/response payloads and status codes.

---

## 13. Frontend / Client Applications

### Primary Frontend (Next.js)
-   **Location**: `src/next-app/`.
-   **Framework**: Next.js 14 App Router.
-   **Routing**: File-system based (`app/` directory).
-   **State Management**: Server Components for data fetching; React Query (likely, needs verification in `package.json` deps) or Server Actions for mutations.
-   **Styling**: Tailwind CSS with RTL support (`tailwindcss-rtl` plugin implied by class names).
-   **Middleware**: `middleware.ts` handles route protection by checking `access_token` and `selected_org` cookies.

### Dashboard Structure
-   **(auth)**: Public login/signup pages.
-   **select-org**: Organization selection screen.
-   **settings**: Tenant-level settings.
-   **components/AppShell**: Contains `TopBar` and `RightSideNav` for the persistent layout.

### Legacy/Prototype Frontend (Vite)
-   **Location**: Root `src/App.tsx`.
-   **Type**: Client-side React app.
-   **Status**: Appears to be an earlier iteration or simple admin panel. Contains basic routing (`OrdersPage`, `InventoryPage`) managed by local state.

---

## 14. Database & Persistence

-   **Technology**: PostgreSQL.
-   **ORM**: Prisma (`@prisma/client`).
-   **Schema**: Defined in `src/prisma/schema.prisma`.
-   **Migrations**: Managed via Prisma Migrate (`prisma migrate`).

### Key Schema Design
-   **UUIDs**: All primary keys are UUIDs.
-   **Audit Fields**: Standard `createdAt`, `updatedAt` on all tables.
-   **JSON Types**: Heavy use of `JSONB` for flexible data like `shipping_address`, `metadata`, and `service_options`.

---

## 15. Configuration & Environments

Configuration is managed via environment variables and the NestJS ConfigModule.

### Configuration Files
-   **Loader**: `src/src/config/configuration.ts`.
-   **Environment**: `.env` and `.env.local` files.

### Key Variables
-   **Server**: `PORT`, `API_PREFIX`.
-   **Database**: `DATABASE_URL`.
-   **Redis**: `REDIS_HOST`, `REDIS_PORT`.
-   **Auth**: `JWT_SECRET`, `JWT_EXPIRES_IN`.
-   **Integrations**:
    -   `SHOPIFY_API_VERSION`
    -   `DHL_API_KEY`, `DHL_API_SECRET`
    -   `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`

---

## 16. Deployment & Operations

### Deployment Model
The system is container-ready but currently configured for local development via Docker Compose.

-   **Infrastructure**: `docker-compose.yml` orchestrates the dependencies.
-   **Services**:
    -   `postgres`: PostgreSQL 16 (Alpine).
    -   `redis`: Redis 7 (Alpine).
    -   `redis-insight`: GUI for inspecting Redis queues.

### Application Runtime
-   **Node.js**: The backend runs as a Node.js process (via NestJS).
-   **Process Management**: Not explicitly configured (e.g., PM2), relying on `npm run start` or similar for now.

### CI/CD Readiness
-   **Linting**: configured in `package.json`.
-   **Testing**: Scripts available (`test:e2e`, `test:integration`).

---

## 17. Testing Strategy

The repository includes a comprehensive testing suite.

### Types of Tests
1.  **Unit Tests**: located in `src/test/unit` (and `*.spec.ts` files alongside source). Focus on individual services.
2.  **Integration Tests**:
    -   Backend: `src/test/integration` and `src/test/webhooks.woocommerce.test.ts`. Tests module interactions and database persistence.
    -   Frontend: `src/next-app/tests/integration`. Tests API routes and middleware.
3.  **E2E Tests**:
    -   Backend: `src/test/orders.e2e-spec.ts`. Tests full API flows.
    -   Playwright: `playwright.config.ts` exists in root, indicating UI end-to-end testing capability.

### Test Infrastructure
-   **Jest**: Primary test runner.
-   **Supertest**: Used for API integration testing.
-   **Fixtures**: `src/test/fixtures` contains sample data for tests.

---

## 18. Security Review

### Implemented Controls
1.  **Transport Security**:
    -   `helmet` middleware enabled in `main.ts` for HTTP header security.
    -   CORS enabled with configurable origin.
2.  **Input Validation**:
    -   `ValidationPipe` enabled globally with `whitelist: true` and `forbidNonWhitelisted: true` to prevent mass assignment attacks.
3.  **Authentication**:
    -   JWT-based stateless auth.
    -   Passwords presumed hashed (referenced in `auth.service.ts` logic, standard practice with NestJS/Passport).
4.  **Access Control**:
    -   Strict `OrganizationGuard` prevents cross-tenant data leaks.

### Known Risks / Non-Goals
-   **Rate Limiting**: Not explicitly visible in `main.ts` or `app.module.ts`.
-   **Refresh Tokens**: JWT strategy uses a single access token; token rotation/refresh flow is not fully visible in the basic strategy.

---

## 19. Known Limitations & Technical Debt

### Missing Features (Partial Implementation)
-   **Frontend Parity**: Two frontend implementations exist (`src/App.tsx` vs `src/next-app`). The Next.js app is the target but the root Vite app still exists.
-   **Refresh Token Flow**: The `JwtStrategy` validates tokens but a dedicated refresh token endpoint/mechanism is not clearly standardized in the visible auth module structure.

### Technical Debt
-   **Monorepo Tooling**: The project structure is a monorepo but lacks dedicated tooling (like Nx or Turborepo) to manage dependencies efficiently between backend and frontend.
-   **Hardcoded Secrets**: Some default secrets exist in `configuration.ts` (e.g., `'dev-secret-change-me'`). These must be overridden in production.

---

## 20. Production Readiness Assessment

### Ready for Production
-   **Core Backend Logic**: Orders, Inventory, and Shipping domains are well-structured.
-   **Database Schema**: normalized and supports multi-tenancy.
-   **Async Processing**: Job queues are correctly implemented for scalability.

### Blocks Production Use
-   **Secret Management**: Default secrets in code must be replaced with strict env vars.
-   **Deployment Configuration**: No `Dockerfile` for the application code itself (only `docker-compose` for dependencies).
-   **Frontend Consolidation**: Must decide on Next.js vs Vite app and remove the unused one to avoid confusion.

### Risk Areas
-   **Rate Limiting**: Lack of rate limiting on API endpoints could expose the system to DoS.
-   **Dependency Management**: `package.json` at root vs `src/next-app/package.json` might lead to version conflicts.

---

## 21. Appendix

### Key Files
-   `src/src/main.ts`: Backend Entry Point.
-   `src/prisma/schema.prisma`: Database Schema.
-   `src/src/queues/queues.ts`: Queue Definitions.
-   `src/next-app/middleware.ts`: Frontend Auth Middleware.

### Glossary
-   **SKU**: Stock Keeping Unit.
-   **Tenant**: An Organization using the platform.
-   **Webhook**: A mechanism for external systems to notify Rappit of events (e.g., new order).
-   **BullMQ**: A Node.js message queue library based on Redis.
