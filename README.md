# Shopify Wishlist App

A NestJS + Fastify backend that adds wishlist functionality to a Shopify storefront. Customer wishlists are stored as JSON metafields on the Shopify Customer object via the Admin GraphQL API. Storefront integration is handled through Shopify App Proxy, and theme assets are installed automatically via the Theme Assets REST API.

The backend is **multi-tenant**: one deployment can serve multiple Shopify stores, each with its own custom app credentials, stored in Firestore rather than `.env`. It can run as a plain long-lived Node process or as a Firebase Cloud Function.

## Tech Stack

- **Framework**: NestJS + Fastify
- **Shopify**: Admin GraphQL API (wishlist data) + REST Admin API (theme installation, webhooks)
- **Per-shop config + token cache**: Firestore (`firebase-admin`)
- **Serverless (optional)**: Firebase Cloud Functions v2 + Hosting
- **Testing**: Jest + ts-jest

---

## 1. Create a Shopify Custom App (per store)

Each store you want to serve needs its **own** custom app — there's no shared OAuth client, so credentials are per-store, not per-deployment.

### 1.1 Create the app

1. Go to that store's Shopify Admin → **Settings** → **Apps**
2. Click **Build apps in Dev Dashboard** — this opens `dev.shopify.com`
3. Click **Create app**, give it a name (e.g. `Wishlist App`), select the store

### 1.2 Configure API scopes

1. Inside the app → **Configuration** → **Admin API access scopes**
2. Enable these scopes:

```
read_customers, write_customers, read_products,
read_themes, write_themes, read_content, write_content
```

3. Save and **release a new version** for the scopes to take effect

### 1.3 Get your credentials

In the app → **Settings**:

| Field     | Where              |
| --------- | ------------------ |
| Client ID | Shown directly     |
| Secret    | Click the eye icon |

These become that store's `apiKey`/`apiSecret` in Firestore — see [Section 3](#3-configure-a-shop-firestore).

### 1.4 Access token

No manual step needed — the app fetches a token automatically per shop, using that shop's `apiKey`/`apiSecret` via OAuth `client_credentials`, and caches it in Firestore. It re-fetches whenever a 401 is returned (e.g. after rotating the secret).

---

## 2. Configure App Proxy (per store)

The App Proxy lets each storefront call your backend through Shopify's domain (so requests carry the customer session and shop identity).

1. In that store's app → **Configuration** → **App Proxy**
2. Fill in:

| Field          | Value                                 |
| -------------- | ------------------------------------- |
| Subpath prefix | `apps`                                |
| Subpath        | `wishlist`                            |
| Proxy URL      | `https://<your-backend-url>/wishlist` |

Same Proxy URL for every store — the backend tells shops apart by the `shop` query param Shopify injects, verified against that shop's own secret.

3. Save — Shopify will forward all `/apps/wishlist/*` storefront requests to your backend, injecting `logged_in_customer_id` and `shop` automatically.

---

## 3. Configure a shop (Firestore)

Per-shop config (`storeUrl`, `apiKey`, `apiSecret`) lives in Firestore, not `.env` — collection `shops/{shopDomain}`, read via `ShopConfigService`. There's no self-serve UI; seed it with the helper script:

```bash
node scripts/add-shop.js <shop>.myshopify.com <apiKey> <apiSecret>
```

This needs Firestore credentials in your environment — either `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account key, or `FIRESTORE_EMULATOR_HOST=localhost:8080` against a local emulator. Re-run the script (it upserts) to rotate a secret or fix a typo.

---

## 4. Local Development

### 4.1 Install dependencies

```bash
npm install
```

### 4.2 Configure environment

`.env` no longer holds per-store credentials — only deployment-wide settings:

```env
# Public URL of this backend — used for App Proxy and webhook registration
APP_URL=https://your-ngrok-url.ngrok.io

PORT=3000

# Shared secret required to call POST/DELETE /install (no App Proxy context there)
INSTALL_SECRET=some-long-random-string

# Firestore — point at a service account key for local dev, or run the emulator
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

Then seed at least one shop (Section 3).

### 4.3 Expose localhost publicly with ngrok

Shopify requires a publicly accessible HTTPS URL for both App Proxy and webhooks.

```bash
# Install ngrok: https://ngrok.com
ngrok http 3000
```

Copy the `https://...ngrok.io` URL and set it as `APP_URL` in `.env`, and as the **Proxy URL** in the Dev Dashboard (Section 2) for each store under test.

### 4.4 Start the server

```bash
npm run start:dev
```

---

## 5. Install Theme Assets

Once the server is running, install all storefront assets for a given shop with a single request. This uploads the JS files, creates the wishlist page, and patches the product page automatically. It requires the `INSTALL_SECRET` from `.env` (there's no App Proxy context on this endpoint).

```bash
curl -X POST "http://localhost:3000/install?shop=<shop>.myshopify.com" \
  -H "x-install-secret: <INSTALL_SECRET>"
```

**What it does:**

| Step | Action                                                                     |
| ---- | -------------------------------------------------------------------------- |
| 1    | Finds the active theme                                                     |
| 2    | Uploads `assets/wishlist-btn.js` and `assets/wishlist-page.js`             |
| 3    | Uploads `sections/wishlist-page.liquid` and `templates/page.wishlist.json` |
| 4    | Patches `sections/main-product.liquid` — injects heart button + script tag |
| 5    | Creates the `/pages/wishlist` Shopify page                                 |
| 6    | Registers the `app/uninstalled` webhook                                    |

Example response:

```json
{
  "success": true,
  "steps": [
    "Active theme ID: 123456789",
    "Uploaded: assets/wishlist-btn.js",
    "Uploaded: assets/wishlist-page.js",
    "Uploaded: sections/wishlist-page.liquid",
    "Uploaded: templates/page.wishlist.json",
    "Patched: sections/main-product.liquid",
    "Created: /pages/wishlist",
    "Synced webhook: https://your-backend/webhooks/app/uninstalled"
  ]
}
```

You can also do this from the browser dashboard: `http://localhost:3000/install?shop=<shop>.myshopify.com&key=<INSTALL_SECRET>` — see Section 8.4.

---

## 6. Uninstall Theme Assets

Before uninstalling the app from a store, run this to cleanly remove all theme changes for that shop:

```bash
curl -X DELETE "http://localhost:3000/install?shop=<shop>.myshopify.com" \
  -H "x-install-secret: <INSTALL_SECRET>"
```

This removes the uploaded assets, reverts `main-product.liquid`, and deletes the wishlist page.

> **Note:** After the app is uninstalled from Shopify, that shop's access token is revoked and theme API calls will fail. Always run `DELETE /install` before uninstalling the app. When the `app/uninstalled` webhook fires, the backend also deletes that shop's cached token and marks its config `disabledAt` (without deleting the stored credentials, so a reinstall doesn't require re-entering them).

---

## 7. API Reference

### Wishlist endpoints

All wishlist endpoints require a valid, per-shop App Proxy HMAC signature (`AppProxyGuard`) plus a logged-in customer. When called through App Proxy, `shop` and `logged_in_customer_id` are injected automatically. For local testing without a real storefront, sign a request yourself:

```bash
QS=$(node scripts/sign-app-proxy-request.js <shop's apiSecret> shop=<shop>.myshopify.com logged_in_customer_id=<id>)
curl "http://localhost:3000/wishlist/list?$QS"
```

| Method | Path                              | Description                                                |
| ------ | --------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/wishlist/list`                  | Returns full product details for all wishlisted items      |
| `GET`  | `/wishlist/check?product_id=<id>` | Returns `{ is_wishlisted: boolean }`                        |
| `POST` | `/wishlist/toggle`                | Adds or removes a product; body: `{ "product_id": "123" }`  |

### Install endpoints

Require `?shop=<shop>.myshopify.com` and an `x-install-secret` header (or `?key=`) matching `INSTALL_SECRET`.

| Method   | Path       | Description                                                           |
| -------- | ---------- | ----------------------------------------------------------------------- |
| `POST`   | `/install` | Sync assets, patch theme, create page, register webhook (idempotent)  |
| `DELETE` | `/install` | Remove all theme changes                                              |

### Webhook endpoints

| Method | Path                        | Description                                           |
| ------ | --------------------------- | ------------------------------------------------------ |
| `POST` | `/webhooks/app/uninstalled` | Shopify fires this when a merchant uninstalls the app |

---

## 8. How It Works

```
Storefront browser (store A or store B)
  └─ GET /apps/wishlist/list
       └─ Shopify App Proxy
            └─ adds logged_in_customer_id, shop, signature to query params
                 └─ GET /wishlist/list?logged_in_customer_id=123&shop=store-a.myshopify.com&...
                      └─ NestJS backend
                           ├─ AppProxyGuard: looks up store-a's secret in Firestore, verifies HMAC
                           └─ Shopify GraphQL API (store-a's own token)
                                └─ read/write customer.metafields.custom.wishlist
```

Wishlists are stored as a JSON array of Shopify product GIDs in the `custom.wishlist` metafield on the Customer object:

```json
["gid://shopify/Product/1234", "gid://shopify/Product/5678"]
```

---

## 9. Deployment

### 9.1 Build

```bash
npm run build
```

Output goes to `dist/`. The `prebuild` hook automatically syncs `storefront/` → `src/install/assets.ts` before compiling.

There are two ways to run the built app:

### 9.2 Option A — plain Node process

```env
APP_URL=https://your-production-domain.com
PORT=3000
INSTALL_SECRET=some-long-random-string
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

```bash
node dist/main
```

Or with PM2:

```bash
npm install -g pm2
pm2 start dist/main.js --name wishlist-app
pm2 save
```

### 9.3 Option B — Firebase Cloud Functions + Hosting

`src/firebase-entry.ts` exports an `onRequest` Cloud Function (`api`) that runs the same Nest+Fastify app, reused across warm invocations. `firebase.json` rewrites all Hosting traffic to it.

```bash
npm install -g firebase-tools
firebase login
```

1. Set your project id in `.firebaserc` (replace `REPLACE_WITH_FIREBASE_PROJECT_ID`)
2. Set Cloud Functions config/env: `APP_URL` (the Hosting/custom domain) and `INSTALL_SECRET` — via `firebase functions:secrets:set` or your project's runtime env config. Firestore access uses the function's default service account automatically (no `GOOGLE_APPLICATION_CREDENTIALS` needed in this mode).
3. Deploy:
   ```bash
   firebase deploy
   ```
4. Firebase Hosting → **Add custom domain**, then follow the DNS/SSL steps in the console.

The `preParsing` hook in `src/bootstrap.ts` handles a Cloud Functions–specific quirk: `onRequest` pre-buffers the body as `req.rawBody` before Fastify sees it, so the hook reuses those bytes for webhook/App-Proxy HMAC verification instead of re-reading an already-consumed stream. Verify this against the Firebase emulator (`firebase emulators:start`) or a real deployed webhook before relying on it in production — it's the one part of this setup that can't be confirmed by local unit tests alone.

### 9.4 Update storefront code

1. Edit files in `storefront/`
2. Run `npm run build` (syncs assets and compiles)
3. Deploy `dist/` (or redeploy the Cloud Function)
4. Hit `POST /install?shop=<shop>` for each shop to push changes to its live theme

### 9.5 Checklist

- [ ] Seed a `shops/{shopDomain}` Firestore doc for each store (`node scripts/add-shop.js`)
- [ ] Set `INSTALL_SECRET` and `APP_URL` for the deployed environment
- [ ] Update the **App Proxy URL** in each store's app → Configuration (`https://your-domain.com/wishlist`)
- [ ] Run `POST /install?shop=<shop>` (with `x-install-secret`) for each shop to upload assets and register the webhook
- [ ] If using Firebase: custom domain connected, `firestore.rules` deployed (deny-all client access), and the raw-body webhook path verified against a real request

---

## 10. Project Structure

```
storefront/                         # Source of truth — edit these, then run npm run sync-assets
├── wishlist-btn.js                 # Heart button — check state on load, toggle on click
├── wishlist-btn.css                # CSS fragment injected into main-product.liquid
├── wishlist-btn.html               # HTML fragment injected into main-product.liquid
├── wishlist-page.js                # Wishlist page — fetch, render cards, handle remove
├── wishlist-page.liquid            # Liquid section for the wishlist page
└── page.wishlist.json              # Shopify JSON template

scripts/
├── sync-assets.js                  # Reads storefront/ and regenerates src/install/assets.ts
├── add-shop.js                     # Seeds/updates a shops/{shop} Firestore doc
└── sign-app-proxy-request.js       # Signs App Proxy query params for local curl testing

src/
├── bootstrap.ts                    # Builds the Nest+Fastify app (shared by main.ts and firebase-entry.ts)
├── main.ts                         # Local dev entrypoint — createApp() + app.listen()
├── firebase-entry.ts               # Cloud Functions v2 onRequest handler
├── common/
│   ├── app-proxy.guard.ts          # Per-shop HMAC signature verification
│   └── current-customer.decorator.ts  # Resolves customer ID + shop, RequireLoginGuard
├── install/
│   ├── assets.ts                   # AUTO-GENERATED — do not edit manually
│   ├── install.service.ts          # Theme Assets API — upload, patch, delete (per-shop context)
│   ├── install-auth.guard.ts       # Shared-secret + shop validation for /install
│   └── install.controller.ts       # GET /install (dashboard), POST, DELETE
├── shopify/
│   ├── shop-config.service.ts      # Firestore-backed per-shop config (shops/{shop})
│   ├── shopify-token.service.ts    # client_credentials fetch + Firestore token cache, per shop
│   └── shopify-admin.service.ts    # GraphQL client — metafield read/write, product fetch (per shop)
├── webhooks/
│   ├── webhooks.service.ts         # Per-shop HMAC verification + uninstall cleanup
│   └── webhooks.controller.ts      # POST /webhooks/app/uninstalled
└── wishlist/
    ├── wishlist.service.ts         # Toggle/list/check business logic (per shop)
    └── wishlist.controller.ts      # GET /wishlist/list, /check, POST /toggle

views/
└── dashboard.hbs                   # Install dashboard UI (requires ?shop=&key=)

firebase.json, .firebaserc, firestore.rules, .firebaseignore   # Firebase deploy config
public/                             # Hosting placeholder (all routes rewrite to the function)
```

## 11. Testing

```bash
npm test             # run all tests
npm run test:watch   # watch mode
```

`AppProxyGuard` is always on, so `/wishlist/*` requires a real signed request, not just a customer ID. Seed a shop (Section 3), then:

```bash
QS=$(node scripts/sign-app-proxy-request.js <shop's apiSecret> shop=<shop>.myshopify.com logged_in_customer_id=<CUSTOMER_ID>)
curl "http://localhost:3000/wishlist/list?$QS"
curl "http://localhost:3000/wishlist/check?$QS&product_id=<PRODUCT_ID>"
curl -X POST "http://localhost:3000/wishlist/toggle?$QS" \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"<PRODUCT_ID>"}'
```

Find customer IDs in Shopify Admin → Customers → click a customer → ID is in the URL.

To test the full multi-store flow (including `InstallService`'s per-shop concurrency safety) without touching real stores, run the Firestore emulator (`firebase emulators:start --only firestore`), seed two shops pointing at local stub servers, and fire concurrent `POST /install?shop=...` requests for each.
