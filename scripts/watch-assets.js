#!/usr/bin/env node
// Watches storefront/ and re-runs sync-assets on any file change.
// nest start --watch then picks up the updated assets.ts and recompiles.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const storefront = path.join(__dirname, '..', 'storefront');
const syncScript = path.join(__dirname, 'sync-assets.js');

let debounce = null;

function sync(filename) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`[watch-assets] ${filename} changed — syncing...`);
    try {
      execSync(`node "${syncScript}"`, { stdio: 'inherit' });
    } catch {
      // error already printed by sync-assets
    }
  }, 100);
}

fs.watch(storefront, (_, filename) => {
  if (filename) sync(filename);
});

console.log('[watch-assets] Watching storefront/ for changes...');
