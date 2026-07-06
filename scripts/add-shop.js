#!/usr/bin/env node
// Seeds (or updates) a shops/{shopDomain} Firestore doc used by ShopConfigService.
// Run against the Firestore emulator by setting FIRESTORE_EMULATOR_HOST first,
// or against a real project by pointing GOOGLE_APPLICATION_CREDENTIALS at a
// service account key.
//
// Usage:
//   node scripts/add-shop.js <shop> <apiKey> <apiSecret>
//
// storeUrl is derived as https://<shop>; apiKey/apiSecret come from that
// store's custom app (Shopify Admin → Settings → Apps → Develop apps).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const [shop, apiKey, apiSecret] = process.argv.slice(2);

if (!shop || !apiKey || !apiSecret) {
  console.error('Usage: node scripts/add-shop.js <shop> <apiKey> <apiSecret>');
  process.exit(1);
}

async function main() {
  initializeApp();
  const db = getFirestore();

  await db
    .collection('shops')
    .doc(shop)
    .set(
      {
        shop,
        storeUrl: `https://${shop}`,
        apiKey,
        apiSecret,
      },
      { merge: true },
    );

  console.log(`Seeded shops/${shop}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
