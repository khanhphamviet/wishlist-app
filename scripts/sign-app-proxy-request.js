#!/usr/bin/env node
// Signs a set of Shopify App Proxy query params with a shop's apiSecret, the
// same way Shopify itself signs storefront App Proxy requests. Lets you curl
// realistic /wishlist/* requests locally without a real storefront.
//
// Usage:
//   node scripts/sign-app-proxy-request.js <apiSecret> shop=foo.myshopify.com logged_in_customer_id=123
//
// Prints the full, ready-to-curl query string (including signature=...).

const { createHmac } = require('crypto');

const [apiSecret, ...pairs] = process.argv.slice(2);

if (!apiSecret || pairs.length === 0) {
  console.error(
    'Usage: node scripts/sign-app-proxy-request.js <apiSecret> shop=foo.myshopify.com logged_in_customer_id=123 ...',
  );
  process.exit(1);
}

const params = {};
for (const pair of pairs) {
  const idx = pair.indexOf('=');
  if (idx === -1) {
    console.error(`Invalid param (expected key=value): ${pair}`);
    process.exit(1);
  }
  params[pair.slice(0, idx)] = pair.slice(idx + 1);
}

const sortedParams = Object.keys(params)
  .sort()
  .map((key) => `${key}=${params[key]}`)
  .join('');

const signature = createHmac('sha256', apiSecret).update(sortedParams).digest('hex');

const query = new URLSearchParams({ ...params, signature }).toString();
console.log(query);
