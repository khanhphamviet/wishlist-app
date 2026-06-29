# CLAUDE.md

## Project

Shopify Wishlist App — NestJS + Fastify backend. Stores wishlists as JSON metafields on Shopify Customer objects. Installs itself into the merchant's theme via the Theme Assets REST API.

## Commands

```bash
npm run start:dev    # sync assets, start with hot reload (kills port 3000 first)
npm run build        # sync assets, then compile TypeScript → dist/
npm run sync-assets  # regenerate src/install/assets.ts from storefront/
npm test             # run Jest tests
```

## Architecture

### Storefront assets pipeline

`storefront/` is the **source of truth** for all client-side code. Never edit `src/install/assets.ts` directly.

```
storefront/*.js / *.liquid / *.json
    ↓  scripts/sync-assets.js
src/install/assets.ts   (auto-generated)
    ↓  nest build
dist/
```

`npm run sync-assets` (or `npm run build`) regenerates `assets.ts`. In dev, `scripts/watch-assets.js` does this automatically on file change.

### Authentication

`ShopifyTokenService` (`src/shopify/shopify-token.service.ts`) manages the Shopify access token:
- Fetches a token on first use via `POST /admin/oauth/access_token` (`grant_type=client_credentials`)
- Caches it in memory
- Auto-refreshes on any 401 response from Shopify

Required env vars: `SHOPIFY_API_KEY` (client_id) + `SHOPIFY_API_SECRET` (client_secret). No `SHOPIFY_ACCESS_TOKEN` needed.

Both `ShopifyAdminService` and `InstallService` call `tokenService.getToken()` before each request and retry once after a 401.

### Customer ID resolution

Shopify App Proxy injects `logged_in_customer_id` as a query param. `resolveCustomerId` in `src/common/current-customer.decorator.ts` checks three sources in order:

1. `req.shopifyCustomerId` — set by `AppProxyGuard` when HMAC verification is active
2. `query.logged_in_customer_id` — injected by App Proxy (production path)
3. `query.customer_id` — for local testing without App Proxy

### Guards

- `AppProxyGuard` (`src/common/app-proxy.guard.ts`) — verifies Shopify HMAC signature. Currently **not applied** because the app is not yet published. Add it back to `@UseGuards(AppProxyGuard, RequireLoginGuard)` in `wishlist.controller.ts` when publishing.
- `RequireLoginGuard` — blocks requests with no resolved customer ID.

### Wishlist storage

Metafield namespace: `custom`, key: `wishlist`, type: `json`. Value is a JSON array of Shopify product GIDs e.g. `["gid://shopify/Product/123"]`.

### Theme installation

`POST /install` is idempotent — safe to call multiple times for both first install and subsequent updates. All steps are either uploads (overwrite) or marker-based replace/skip logic.

### Module structure

`ShopifyModule` exports `ShopifyTokenService` and `ShopifyAdminService`. Both `WishlistModule` and `InstallModule` import it.

### API version

Hardcoded to `2026-04` in:
- `src/shopify/shopify-admin.service.ts` (GraphQL endpoint)
- `src/install/install.service.ts` (REST API calls)

Update both when upgrading.

## Key Files

| File | Purpose |
|------|---------|
| `storefront/wishlist-btn.js` | Heart button — check state on load, toggle on click, redirect to login on 401 |
| `storefront/wishlist-page.js` | Wishlist page — fetch list, render cards, handle remove |
| `storefront/wishlist-page.liquid` | Liquid section — passes locale/currency/i18n strings as data attributes |
| `scripts/sync-assets.js` | Reads `storefront/`, regenerates `src/install/assets.ts` |
| `src/install/assets.ts` | AUTO-GENERATED — do not edit manually |
| `src/install/install.service.ts` | Theme Assets API — upload files, patch Liquid, merge locales, create page |
| `src/shopify/shopify-token.service.ts` | Token manager — client_credentials fetch + auto-refresh on 401 |
| `src/shopify/shopify-admin.service.ts` | GraphQL client — read/write customer metafields, fetch products |
| `src/shopify/shopify.module.ts` | Shared module — exports ShopifyTokenService + ShopifyAdminService |
| `src/common/current-customer.decorator.ts` | Customer ID resolution + `RequireLoginGuard` |
| `views/dashboard.hbs` | Install dashboard UI — Install / Update / Uninstall buttons |

## Local Testing

```bash
# Start server
npm run start:dev

# Test with explicit customer ID (bypasses guard)
curl 'http://localhost:3000/wishlist/list?customer_id=<CUSTOMER_ID>'
curl 'http://localhost:3000/wishlist/check?customer_id=<CUSTOMER_ID>&product_id=<PRODUCT_ID>'
curl -X POST 'http://localhost:3000/wishlist/toggle?customer_id=<CUSTOMER_ID>' \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"<PRODUCT_ID>"}'

# Install / update theme assets (or open http://localhost:3000/install in browser)
curl -X POST http://localhost:3000/install
```

Find customer IDs: Shopify Admin → Customers → click a customer → ID is the number in the URL.

## Publishing Checklist

- [ ] Re-enable `AppProxyGuard` in `wishlist.controller.ts`
- [ ] Set `APP_URL` to the production backend URL
- [ ] Update App Proxy URL in Shopify Dev Dashboard → Configuration (`Subpath: wishlist`, `Proxy URL: https://<backend>/wishlist`)
- [ ] Confirm API scopes: `read_customers write_customers read_products read_themes write_themes read_content write_content`
- [ ] Run `POST /install` on the production server to upload assets and register the webhook
