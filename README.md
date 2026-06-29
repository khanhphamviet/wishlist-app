# Shopify Wishlist App

A NestJS + Fastify backend that adds wishlist functionality to a Shopify storefront. Customer wishlists are stored as JSON metafields on the Shopify Customer object via the Admin GraphQL API. Storefront integration is handled through Shopify App Proxy, and theme assets are installed automatically via the Theme Assets REST API.

## Tech Stack

- **Framework**: NestJS + Fastify
- **Shopify**: Admin GraphQL API (wishlist data) + REST Admin API (theme installation, webhooks)
- **Testing**: Jest + ts-jest

---

## 1. Create a Shopify Custom App

### 1.1 Create the app

1. Go to your Shopify Admin → **Settings** → **Apps**
2. Click **Build apps in Dev Dashboard** — this opens `dev.shopify.com`
3. Click **Create app**, give it a name (e.g. `Wishlist App`), select your store

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

| Field     | Where              | .env key             |
| --------- | ------------------ | -------------------- |
| Client ID | Shown directly     | —                    |
| Secret    | Click the eye icon | `SHOPIFY_API_SECRET` |

### 1.4 Access token

No manual step needed — the app fetches a token automatically on startup using `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` via OAuth `client_credentials`. It also re-fetches whenever a 401 is returned (e.g. after rotating the secret).

---

## 2. Configure App Proxy

The App Proxy lets the storefront call your backend through Shopify's domain (so requests carry the customer session).

1. In your app → **Configuration** → **App Proxy**
2. Fill in:

| Field          | Value                                 |
| -------------- | ------------------------------------- |
| Subpath prefix | `apps`                                |
| Subpath        | `wishlist`                            |
| Proxy URL      | `https://<your-backend-url>/wishlist` |

3. Save — Shopify will forward all `/apps/wishlist/*` storefront requests to your backend, injecting `logged_in_customer_id` automatically.

---

## 3. Local Development

### 3.1 Install dependencies

```bash
npm install
```

### 3.2 Configure environment

```env
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret

# Public URL of this backend — used for App Proxy and webhook registration
APP_URL=https://your-ngrok-url.ngrok.io

PORT=3000
```

### 3.3 Expose localhost publicly with ngrok

Shopify requires a publicly accessible HTTPS URL for both App Proxy and webhooks.

```bash
# Install ngrok: https://ngrok.com
ngrok http 3000
```

Copy the `https://...ngrok.io` URL and set it as `APP_URL` in `.env`, and as the **Proxy URL** in the Partners dashboard (step 2).

### 3.4 Start the server

```bash
npm run start:dev
```

---

## 4. Install Theme Assets

Once the server is running, install all storefront assets with a single request. This uploads the JS files, creates the wishlist page, and patches the product page automatically.

```bash
curl -X POST http://localhost:3000/install
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
    "Registered webhook: https://your-backend/webhooks/app/uninstalled"
  ]
}
```

---

## 5. Uninstall Theme Assets

Before uninstalling the app from Shopify, run this to cleanly remove all theme changes:

```bash
curl -X DELETE http://localhost:3000/install
```

This removes the uploaded assets, reverts `main-product.liquid`, and deletes the wishlist page.

> **Note:** After the app is uninstalled from Shopify, the access token is revoked and theme API calls will fail. Always run `DELETE /install` before uninstalling the app.

---

## 6. API Reference

### Wishlist endpoints

All wishlist endpoints require a logged-in customer. When called through App Proxy, the customer ID is injected automatically. For local testing, pass `?customer_id=<id>`.

| Method | Path                              | Description                                                |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/wishlist/list`                  | Returns full product details for all wishlisted items      |
| `GET`  | `/wishlist/check?product_id=<id>` | Returns `{ is_wishlisted: boolean }`                       |
| `POST` | `/wishlist/toggle`                | Adds or removes a product; body: `{ "product_id": "123" }` |

### Install endpoints

| Method   | Path       | Description                                                                   |
| -------- | ---------- | ----------------------------------------------------------------------------- |
| `POST`   | `/install` | Sync assets, patch theme, create page, register webhook (idempotent)          |
| `DELETE` | `/install` | Remove all theme changes                                                       |

### Webhook endpoints

| Method | Path                        | Description                                           |
| ------ | --------------------------- | ----------------------------------------------------- |
| `POST` | `/webhooks/app/uninstalled` | Shopify fires this when a merchant uninstalls the app |

---

## 7. How It Works

```
Storefront browser
  └─ GET /apps/wishlist/list
       └─ Shopify App Proxy
            └─ adds logged_in_customer_id, shop, signature to query params
                 └─ GET /wishlist/list?logged_in_customer_id=123&...
                      └─ NestJS backend
                           └─ Shopify GraphQL API
                                └─ read/write customer.metafields.custom.wishlist
```

Wishlists are stored as a JSON array of Shopify product GIDs in the `custom.wishlist` metafield on the Customer object:

```json
["gid://shopify/Product/1234", "gid://shopify/Product/5678"]
```

---

## 8. Deployment

### 8.1 Build

```bash
npm run build
```

Output goes to `dist/`. The `prebuild` hook automatically syncs `storefront/` → `src/install/assets.ts` before compiling.

### 8.2 Environment variables on the server

Set these in `.env` (or your host's env config panel):

```env
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret

APP_URL=https://your-production-domain.com

PORT=3000
```

The app fetches the Shopify access token automatically on first request — no `SHOPIFY_ACCESS_TOKEN` needed.

### 8.3 Start in production

```bash
node dist/main
```

Or with PM2 for process management:

```bash
npm install -g pm2
pm2 start dist/main.js --name wishlist-app
pm2 save
```

### 8.4 Install / update theme assets

Open the dashboard in a browser and click **Install** (or **Update** after code changes):

```
https://your-production-domain.com/install
```

Or via curl:

```bash
curl -X POST https://your-production-domain.com/install
```

### 8.5 Update storefront code

1. Edit files in `storefront/`
2. Run `npm run build` (syncs assets and compiles)
3. Deploy `dist/` to the server
4. Hit `POST /install` to push changes to the live theme

### 8.6 Checklist

- [ ] Set env vars on the server
- [ ] Update `APP_URL` to the production URL
- [ ] Update the **App Proxy URL** in your app → Configuration (`https://your-domain.com/wishlist`)
- [ ] Re-enable `AppProxyGuard` in `src/wishlist/wishlist.controller.ts`
- [ ] Run `POST /install` to upload assets and register the webhook

---

## 9. Project Structure

```
storefront/                         # Source of truth — edit these, then run npm run sync-assets
├── wishlist-btn.js                 # Heart button — check state on load, toggle on click
├── wishlist-btn.css                # CSS fragment injected into main-product.liquid
├── wishlist-btn.html               # HTML fragment injected into main-product.liquid
├── wishlist-page.js                # Wishlist page — fetch, render cards, handle remove
├── wishlist-page.liquid            # Liquid section for the wishlist page
└── page.wishlist.json              # Shopify JSON template

scripts/
└── sync-assets.js                  # Reads storefront/ and regenerates src/install/assets.ts

src/
├── common/
│   ├── app-proxy.guard.ts          # HMAC signature verification (for published apps)
│   └── current-customer.decorator.ts  # Resolves customer ID + RequireLoginGuard
├── install/
│   ├── assets.ts                   # AUTO-GENERATED — do not edit manually
│   ├── install.service.ts          # Theme Assets API — upload, patch, delete
│   └── install.controller.ts       # GET /install (dashboard), POST, POST /update, DELETE
├── shopify/
│   └── shopify-admin.service.ts    # GraphQL client — metafield read/write, product fetch
├── webhooks/
│   ├── webhooks.service.ts         # HMAC verification + uninstall handler
│   └── webhooks.controller.ts      # POST /webhooks/app/uninstalled
└── wishlist/
    ├── wishlist.service.ts         # Toggle/list/check business logic
    └── wishlist.controller.ts      # GET /wishlist/list, /check, POST /toggle

views/
└── dashboard.hbs                   # Install dashboard UI (Handlebars template)
```

## 10. Testing

```bash
npm test             # run all tests
npm run test:watch   # watch mode
```

Local testing without App Proxy (find your customer ID in Shopify Admin → Customers → click a customer → ID is in the URL):

```bash
curl 'http://localhost:3000/wishlist/list?customer_id=<CUSTOMER_ID>'
curl 'http://localhost:3000/wishlist/check?customer_id=<CUSTOMER_ID>&product_id=<PRODUCT_ID>'
curl -X POST 'http://localhost:3000/wishlist/toggle?customer_id=<CUSTOMER_ID>' \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"<PRODUCT_ID>"}'
```

# wishlist-app
