#!/usr/bin/env node
// Calls POST /install for every configured (non-disabled) shop in Firestore —
// used to push updated storefront assets (theme JS/liquid) to all stores
// without a human having to trigger /install per shop.
//
// Requires:
//   GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key (to read
//   the `shops` collection from Firestore)
//   APP_URL and INSTALL_SECRET env vars (same values as in .env)
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   APP_URL=https://wishlist-5b093.web.app \
//   INSTALL_SECRET=xxx \
//     node scripts/install-all-shops.js

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function main() {
  const appUrl = process.env.APP_URL;
  const installSecret = process.env.INSTALL_SECRET;
  if (!appUrl || !installSecret) {
    console.error('APP_URL and INSTALL_SECRET env vars are required.');
    process.exit(1);
  }

  initializeApp();
  const db = getFirestore();
  const snap = await db.collection('shops').get();

  const shops = snap.docs.map((doc) => doc.data()).filter((data) => !data.disabledAt);

  console.log(`Found ${shops.length} active shop(s).`);

  let failures = 0;
  for (const { shop } of shops) {
    process.stdout.write(`Installing for ${shop}... `);
    try {
      const res = await fetch(`${appUrl}/install?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { 'x-install-secret': installSecret },
      });
      if (!res.ok) {
        console.log(`FAILED (${res.status}): ${await res.text()}`);
        failures++;
        continue;
      }
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`${failures} shop(s) failed to install.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
