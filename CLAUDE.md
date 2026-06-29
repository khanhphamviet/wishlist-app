# CLAUDE.md

## Project

Shopify Wishlist App — NestJS + Fastify backend. Stores wishlists as JSON metafields on Shopify Customer objects. Installs itself into the merchant's theme via the Theme Assets REST API.

## Commands

```bash
npm run start:dev   # start with hot reload (kills port 3000 first)
npm test            # run Jest tests
npm run build       # compile TypeScript
```

## Architecture

### Customer ID resolution

Shopify App Proxy injects `logged_in_customer_id` as a query param on forwarded requests. The `resolveCustomerId` function in `src/common/current-customer.decorator.ts` checks three sources in order:

1. `req.shopifyCustomerId` — set by `AppProxyGuard` when HMAC verification is active
2. `query.logged_in_customer_id` — injected by App Proxy (production path)
3. `query.customer_id` — for local testing without App Proxy

### Guards

- `AppProxyGuard` (`src/common/app-proxy.guard.ts`) — verifies Shopify HMAC signature. Currently **not applied** to the controller because the app is not yet published. Add it back to `@UseGuards(AppProxyGuard, RequireLoginGuard)` in `wishlist.controller.ts` when publishing.
- `RequireLoginGuard` — blocks requests with no resolved customer ID.

### Wishlist storage

Metafield namespace: `custom`, key: `wishlist`, type: `json`. Value is a JSON array of Shopify product GIDs e.g. `["gid://shopify/Product/123"]`.

### Theme installation

`src/install/assets.ts` is the **single source of truth** for all storefront code. When JS or Liquid changes, update the constants there and call `POST /install/update` to push to the live theme.

`POST /install` is idempotent — safe to call multiple times. It skips steps already done (checks for marker strings before patching theme files).

### API version

Hardcoded to `2026-04` in:
- `src/shopify/shopify-admin.service.ts` (GraphQL endpoint)
- `src/install/install.service.ts` (REST API calls)

Update both when upgrading.

## Key Files

| File | Purpose |
|------|---------|
| `src/install/assets.ts` | Storefront JS + Liquid as TS string constants |
| `src/install/install.service.ts` | Theme Assets API — upload files, patch Liquid, create page |
| `src/shopify/shopify-admin.service.ts` | GraphQL client — read/write customer metafields, fetch products |
| `src/common/current-customer.decorator.ts` | Customer ID resolution + `RequireLoginGuard` |
| `storefront/wishlist-btn.js` | Heart button — check state on load, toggle on click, redirect to login on 401 |
| `storefront/wishlist-page.js` | Wishlist page — fetch list, render cards, handle remove |

## Local Testing

```bash
# Start server
npm run start:dev

# Test with explicit customer ID (bypasses guard)
curl 'http://localhost:3000/wishlist/list?customer_id=<CUSTOMER_ID>'
curl 'http://localhost:3000/wishlist/check?customer_id=<CUSTOMER_ID>&product_id=<PRODUCT_ID>'
curl -X POST http://localhost:3000/wishlist/toggle \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"<PRODUCT_ID>"}' \
  '?customer_id=<CUSTOMER_ID>'

# Install theme assets
curl -X POST http://localhost:3000/install

# Push JS/Liquid changes to theme
curl -X POST http://localhost:3000/install/update
```

Find customer IDs at: Shopify Admin → Customers → click customer → ID is the number in the URL.

## Publishing Checklist

- [ ] Re-enable `AppProxyGuard` in `wishlist.controller.ts`
- [ ] Set App Proxy URL in Shopify Partners dashboard (`Subpath: wishlist`, `Proxy URL: https://<backend>/wishlist`)
- [ ] Add `SHOPIFY_API_SECRET` to `.env` (needed by `AppProxyGuard`)
- [ ] Confirm API scopes: `read_customers write_customers read_products read_themes write_themes read_content write_content`
- [ ] Run `POST /install` against the merchant's store after app installation
