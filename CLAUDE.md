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

### Multi-store

The app is multi-tenant: each Shopify store has its **own** custom app (own
`apiKey`/`apiSecret`, no shared OAuth client) and its own storeUrl. Per-shop
config lives in Firestore, not env vars: collection `shops/{shopDomain}` →
`{ shop, storeUrl, apiKey, apiSecret, disabledAt? }`, read via
`ShopConfigService` (`src/shopify/shop-config.service.ts`). Shop docs are
added manually (Firebase console or `npm run add-shop -- <shop> <apiKey> <apiSecret>`)
— there's no self-serve onboarding flow.

Every Shopify-facing service takes `shop: string` as an explicit parameter
(`ShopifyTokenService.getToken(shop)`, `ShopifyAdminService.getWishlistProductIds(shop, ...)`,
`InstallService.install(shop)`, etc.) — **never** cache shop context on `this`
in a singleton provider. `InstallService` in particular threads a small
`{ shop, storeUrl }` context object through every private helper instead of
storing `storeUrl` as instance state, because concurrent installs for
different shops interleave across many awaited Shopify calls.

### Authentication

`ShopifyTokenService` (`src/shopify/shopify-token.service.ts`) manages the Shopify access token, per shop:
- Fetches a token on first use via `POST /admin/oauth/access_token` (`grant_type=client_credentials`), using that shop's `apiKey`/`apiSecret` from `ShopConfigService`
- Caches it in Firestore (`shopify_tokens/{shop}`), not in memory — required for serverless (cache survives cold starts)
- Auto-refreshes on any 401 response from Shopify

No env vars needed for credentials — see Multi-store above.

Both `ShopifyAdminService` and `InstallService` call `tokenService.getToken(shop)` before each request and retry once after a 401.

### Customer ID / shop resolution

Shopify App Proxy injects `logged_in_customer_id` and `shop` as query params. `resolveCustomerId`/`resolveShop` in `src/common/current-customer.decorator.ts` each check two sources in order:

1. `req.shopifyCustomerId` / `req.shopDomain` — set by `AppProxyGuard` (or `InstallAuthGuard` for `shopDomain`) once HMAC/key verification passes
2. `query.logged_in_customer_id` / `query.shop` — for local testing without a real App Proxy request (see Local Testing)

### Guards

- `AppProxyGuard` (`src/common/app-proxy.guard.ts`) — verifies Shopify HMAC signature using the **shop-specific** secret (looked up via `ShopConfigService` from the untrusted `shop` query param, then verified). Applied via `@UseGuards(AppProxyGuard, RequireLoginGuard)` on `wishlist.controller.ts` — always on, not conditional on publishing, since `shop=` is a real tenant-selection boundary now that multiple stores share one deployment. Unknown-shop and bad-signature failures return the same generic 401 message.
- `RequireLoginGuard` — blocks requests with no resolved customer ID. Must run after `AppProxyGuard`.
- `InstallAuthGuard` (`src/install/install-auth.guard.ts`) — `/install` has no App Proxy context (admin-triggered, not storefront traffic), so it requires `?shop=` plus a shared `INSTALL_SECRET` (env var) sent as `x-install-secret` header or `?key=` query param.

### Wishlist storage

Metafield namespace: `custom`, key: `wishlist`, type: `json`. Value is a JSON array of Shopify product GIDs e.g. `["gid://shopify/Product/123"]`.

### Theme installation

`POST /install` is idempotent — safe to call multiple times for both first install and subsequent updates. All steps are either uploads (overwrite) or marker-based replace/skip logic.

### Module structure

`ShopifyModule` exports `ShopConfigService`, `ShopifyTokenService`, and `ShopifyAdminService`. `WishlistModule`, `InstallModule`, and `WebhooksModule` all import it.

### Serverless (Firebase Cloud Functions)

`src/bootstrap.ts` builds the Nest+Fastify app (`createApp()`) without starting a listener. `src/main.ts` calls it and `.listen()`s for local dev. `src/firebase-entry.ts` calls it once per warm container and bridges Cloud Functions' `req`/`res` into the same Fastify server via `server.emit('request', req, res)` — see that file for the raw-body caveat (Cloud Functions pre-buffers the body as `req.rawBody`; the `preParsing` hook in `bootstrap.ts` reuses those bytes instead of re-reading an already-consumed stream). Deploy config: `firebase.json`, `.firebaserc`, `firestore.rules` (deny-all client access — Firestore is server-only via the Admin SDK), `.firebaseignore`.

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
| `src/install/install.service.ts` | Theme Assets API — upload files, patch Liquid, merge locales, create page (per-shop `InstallCtx`, see Multi-store) |
| `src/install/install-auth.guard.ts` | Shared-secret + shop validation for `/install` (no App Proxy context) |
| `src/shopify/shopify-token.service.ts` | Token manager — client_credentials fetch + auto-refresh on 401, Firestore-cached per shop |
| `src/shopify/shopify-admin.service.ts` | GraphQL client — read/write customer metafields, fetch products (per-shop `GraphQLClient` cache) |
| `src/shopify/shop-config.service.ts` | Firestore-backed per-shop config (`shops/{shop}`) — storeUrl/apiKey/apiSecret lookup |
| `src/shopify/shopify.module.ts` | Shared module — exports ShopConfigService + ShopifyTokenService + ShopifyAdminService |
| `src/common/current-customer.decorator.ts` | Customer ID + shop resolution, `RequireLoginGuard` |
| `src/common/app-proxy.guard.ts` | Per-shop HMAC verification for App Proxy requests |
| `src/bootstrap.ts` | Builds the Nest+Fastify app (shared by local dev and Firebase entry) |
| `src/firebase-entry.ts` | Cloud Functions v2 `onRequest` handler — bridges into the Fastify app |
| `views/dashboard.hbs` | Install dashboard UI — Install / Update / Uninstall buttons (requires `?shop=&key=`) |
| `scripts/add-shop.js` | Seeds/updates a `shops/{shop}` Firestore doc |
| `scripts/sign-app-proxy-request.js` | Signs App Proxy query params with a shop's `apiSecret`, for local curl testing |

## Local Testing

```bash
# Start server
npm run start:dev

# AppProxyGuard is always on — /wishlist/* requests need a valid per-shop
# HMAC signature, not just a customer_id. Sign a request for a configured shop:
QS=$(node scripts/sign-app-proxy-request.js <SHOP_API_SECRET> shop=<SHOP_DOMAIN> logged_in_customer_id=<CUSTOMER_ID>)
curl "http://localhost:3000/wishlist/list?$QS"
curl "http://localhost:3000/wishlist/check?$QS&product_id=<PRODUCT_ID>"
curl -X POST "http://localhost:3000/wishlist/toggle?$QS" \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"<PRODUCT_ID>"}'

# Install / update theme assets for a shop (needs INSTALL_SECRET from .env,
# or open http://localhost:3000/install?shop=<SHOP_DOMAIN>&key=<INSTALL_SECRET> in browser)
curl -X POST "http://localhost:3000/install?shop=<SHOP_DOMAIN>" -H "x-install-secret: <INSTALL_SECRET>"
```

Seed a shop first with `npm run add-shop -- <shop> <apiKey> <apiSecret>` (needs `GOOGLE_APPLICATION_CREDENTIALS` or `FIRESTORE_EMULATOR_HOST` set). Find customer IDs: Shopify Admin → Customers → click a customer → ID is the number in the URL.

## Publishing Checklist

- [ ] Seed a `shops/{shopDomain}` Firestore doc for each store being onboarded (`npm run add-shop`)
- [ ] Set `INSTALL_SECRET` and `APP_URL` to real values for the deployed environment
- [ ] Update App Proxy URL in each store's Shopify Dev Dashboard → Configuration (`Subpath: wishlist`, `Proxy URL: https://<backend>/wishlist`)
- [ ] Confirm API scopes per shop's custom app: `read_customers write_customers read_products read_themes write_themes read_content write_content`
- [ ] Run `POST /install?shop=<shop>` (with `x-install-secret`) to upload assets and register the webhook for each shop
- [ ] If deploying to Firebase: set `.firebaserc` project id, deploy (`firebase deploy`), connect the custom domain via Firebase Hosting, and verify the `req.rawBody` bridge (see Serverless section) against a real webhook before relying on it
