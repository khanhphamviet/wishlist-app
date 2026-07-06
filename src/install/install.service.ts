import { Injectable, Logger } from '@nestjs/common';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ShopConfigService } from '../shopify/shop-config.service';
import { ShopifyTokenService } from '../shopify/shopify-token.service';
import {
  WISHLIST_BTN_CSS,
  WISHLIST_BTN_HTML,
  WISHLIST_BTN_JS,
  WISHLIST_LOCALE_EN,
  WISHLIST_LOCALE_JA,
  WISHLIST_LOCALE_KO,
  WISHLIST_LOCALE_ZH_TW,
  WISHLIST_PAGE_JS,
  WISHLIST_PAGE_LIQUID,
  WISHLIST_PAGE_TEMPLATE_JSON,
} from './assets';

const LOCALES = [
  { key: 'locales/en.default.json', content: () => WISHLIST_LOCALE_EN },
  { key: 'locales/ja.json', content: () => WISHLIST_LOCALE_JA },
  { key: 'locales/zh-TW.json', content: () => WISHLIST_LOCALE_ZH_TW },
  { key: 'locales/ko.json', content: () => WISHLIST_LOCALE_KO },
];

/**
 * Per-call store context. Passed explicitly through every helper instead of
 * held as instance state — InstallService is a singleton provider, and
 * concurrent installs for different shops interleave across many awaited
 * Shopify calls, so shop context can never live on `this`.
 */
interface InstallCtx {
  shop: string;
  storeUrl: string;
}

@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);
  private readonly apiVersion = '2026-04';

  constructor(
    private readonly tokenService: ShopifyTokenService,
    private readonly shopConfigService: ShopConfigService,
  ) {}

  private get db() {
    if (getApps().length === 0) {
      initializeApp();
    }
    return getFirestore();
  }

  /**
   * Audit trail for /install and /uninstall runs — lets us see which shops
   * got the latest storefront assets and when, especially now that
   * install-all-shops.js pushes updates to every shop unattended.
   */
  private async logInstallRun(
    shop: string,
    action: 'install' | 'uninstall',
    result: { success: boolean; steps?: string[]; error?: string },
  ): Promise<void> {
    await this.db.collection('install_logs').add({
      shop,
      action,
      success: result.success,
      steps: result.steps ?? [],
      error: result.error ?? null,
      timestamp: Date.now(),
    });
  }

  private async shopifyFetch<T = any>(
    ctx: InstallCtx,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${ctx.storeUrl}/admin/api/${this.apiVersion}${path}`;

    const doFetch = async (token: string) =>
      fetch(url, {
        ...options,
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        },
      });

    let res = await doFetch(await this.tokenService.getToken(ctx.shop));

    if (res.status === 401) {
      res = await doFetch(await this.tokenService.refreshToken(ctx.shop));
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify ${res.status} on ${path}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async getActiveThemeId(ctx: InstallCtx): Promise<string> {
    const data = await this.shopifyFetch<{ themes: { id: number; role: string }[] }>(
      ctx,
      '/themes.json',
    );
    const theme = data.themes.find((t) => t.role === 'main');
    if (!theme) throw new Error('No active theme found');
    return String(theme.id);
  }

  private async uploadAsset(
    ctx: InstallCtx,
    themeId: string,
    key: string,
    value: string,
  ): Promise<void> {
    await this.shopifyFetch(ctx, `/themes/${themeId}/assets.json`, {
      method: 'PUT',
      body: JSON.stringify({ asset: { key, value } }),
    });
    this.logger.log(`Uploaded: ${key}`);
  }

  private async getAsset(ctx: InstallCtx, themeId: string, key: string): Promise<string | null> {
    try {
      const data = await this.shopifyFetch<{ asset: { value: string } }>(
        ctx,
        `/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
      );
      return data.asset.value;
    } catch {
      return null;
    }
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  private async mergeLocales(ctx: InstallCtx, themeId: string): Promise<string[]> {
    const results: string[] = [];
    for (const { key, content } of LOCALES) {
      const existing = await this.getAsset(ctx, themeId, key);
      const wishlistKeys = JSON.parse(content());
      const merged = existing ? this.deepMerge(JSON.parse(existing), wishlistKeys) : wishlistKeys;
      await this.uploadAsset(ctx, themeId, key, JSON.stringify(merged, null, 2));
      results.push(`Merged locale keys: ${key}`);
    }
    return results;
  }

  private async removeLocaleKeys(ctx: InstallCtx, themeId: string): Promise<string[]> {
    const results: string[] = [];
    for (const { key } of LOCALES) {
      const existing = await this.getAsset(ctx, themeId, key);
      if (!existing) {
        results.push(`Skipped: ${key} not found`);
        continue;
      }

      const current = JSON.parse(existing);
      if (!current.wishlist) {
        results.push(`Skipped: no wishlist keys in ${key}`);
        continue;
      }

      delete current.wishlist;
      await this.uploadAsset(ctx, themeId, key, JSON.stringify(current, null, 2));
      results.push(`Removed wishlist keys from: ${key}`);
    }
    return results;
  }

  // Removes old markerless wishlist button injections (from installs before markers were added).
  // Finds every <button ...class="wishlist-btn wishlist-btn--overlay"...>...</button> block and
  // removes it so repeated installs don't accumulate duplicate buttons.
  private stripOldBtnInjection(content: string): string {
    const OPEN_PATTERN = '<button';
    const MARKER_CLASS = 'wishlist-btn--overlay';
    let result = content;
    let searchFrom = 0;

    while (true) {
      const openIdx = result.indexOf(OPEN_PATTERN, searchFrom);
      if (openIdx === -1) break;

      const closeIdx = result.indexOf('</button>', openIdx);
      if (closeIdx === -1) break;

      const block = result.slice(openIdx, closeIdx + '</button>'.length);

      if (block.includes(MARKER_CLASS)) {
        result = result.slice(0, openIdx) + result.slice(closeIdx + '</button>'.length);
        // don't advance searchFrom — next character is now at openIdx
      } else {
        searchFrom = closeIdx + 1;
      }
    }

    return result;
  }

  private readonly CSS_START = '/* wishlist-app:css-start */';
  private readonly CSS_END = '/* wishlist-app:css-end */';
  private readonly BTN_START = '<!-- wishlist-app:btn-start -->';
  private readonly BTN_END = '<!-- wishlist-app:btn-end -->';

  private async patchMainProduct(ctx: InstallCtx, themeId: string): Promise<string> {
    const key = 'sections/main-product.liquid';
    const content = await this.getAsset(ctx, themeId, key);
    if (!content) return `Skipped: ${key} not found in theme`;

    let patched = content;

    // CSS — replace existing block or insert before {%- endstyle -%}
    if (patched.includes(this.CSS_START)) {
      const s = patched.indexOf(this.CSS_START);
      const e = patched.indexOf(this.CSS_END) + this.CSS_END.length;
      patched = patched.slice(0, s) + WISHLIST_BTN_CSS + patched.slice(e);
    } else {
      patched = patched.replace('{%- endstyle -%}', `${WISHLIST_BTN_CSS}{%- endstyle -%}`);
    }

    // HTML — replace existing block or insert after gallery render tag
    if (patched.includes(this.BTN_START)) {
      // New-style: markers present — replace between them
      const s = patched.indexOf(this.BTN_START);
      const e = patched.indexOf(this.BTN_END) + this.BTN_END.length;
      patched = patched.slice(0, s) + WISHLIST_BTN_HTML + patched.slice(e);
    } else {
      // Old-style (no markers): strip any existing wishlist-btn injection so we
      // don't accumulate duplicate buttons on repeated installs.
      patched = this.stripOldBtnInjection(patched);

      const galleryTag = `{% render 'product-media-gallery'`;
      const idx = patched.indexOf(galleryTag);
      if (idx !== -1) {
        const tagEnd = patched.indexOf('%}', idx) + 2;
        patched = patched.slice(0, tagEnd) + WISHLIST_BTN_HTML + patched.slice(tagEnd);
      }
    }

    // Script tag — insert once
    if (!patched.includes('wishlist-btn.js')) {
      patched = patched.replace(
        '</product-info>',
        `  <script src="{{ 'wishlist-btn.js' | asset_url }}" defer></script>\n</product-info>`,
      );
    }

    await this.uploadAsset(ctx, themeId, key, patched);
    return `Patched: ${key}`;
  }

  private async syncWebhook(ctx: InstallCtx): Promise<string> {
    const appUrl = process.env.APP_URL;
    if (!appUrl) return 'Skipped: APP_URL not set in .env';

    const address = `${appUrl}/webhooks/app/uninstalled`;

    const existing = await this.shopifyFetch<{ webhooks: { id: number; address: string }[] }>(
      ctx,
      '/webhooks.json?topic=app%2Funinstalled',
    );

    // Delete stale webhooks pointing at a different URL (e.g. old ngrok address)
    for (const w of existing.webhooks) {
      if (w.address !== address) {
        await this.shopifyFetch(ctx, `/webhooks/${w.id}.json`, { method: 'DELETE' });
      }
    }

    // Create if not already registered at the current address
    if (!existing.webhooks.some((w) => w.address === address)) {
      await this.shopifyFetch(ctx, '/webhooks.json', {
        method: 'POST',
        body: JSON.stringify({
          webhook: { topic: 'app/uninstalled', address, format: 'json' },
        }),
      });
    }

    return `Synced webhook: ${address}`;
  }

  private async syncWishlistPage(ctx: InstallCtx): Promise<string> {
    const data = await this.shopifyFetch<{ pages: { id: number }[] }>(
      ctx,
      '/pages.json?handle=wishlist',
    );
    const page = { title: 'Wishlist', handle: 'wishlist', template_suffix: 'wishlist' };

    if (data.pages.length > 0) {
      const pageId = data.pages[0].id;
      await this.shopifyFetch(ctx, `/pages/${pageId}.json`, {
        method: 'PUT',
        body: JSON.stringify({ page }),
      });
      return 'Synced: /pages/wishlist';
    }

    await this.shopifyFetch(ctx, '/pages.json', {
      method: 'POST',
      body: JSON.stringify({ page }),
    });
    return 'Created: /pages/wishlist';
  }

  private async deleteAsset(ctx: InstallCtx, themeId: string, key: string): Promise<void> {
    try {
      await this.shopifyFetch(
        ctx,
        `/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      this.logger.log(`Deleted: ${key}`);
    } catch {
      this.logger.warn(`Skipped delete (not found): ${key}`);
    }
  }

  private async unpatchMainProduct(ctx: InstallCtx, themeId: string): Promise<string> {
    const key = 'sections/main-product.liquid';
    const content = await this.getAsset(ctx, themeId, key);
    if (!content) return `Skipped: ${key} not found`;

    const hasCss = content.includes(this.CSS_START);
    const hasBtn = content.includes(this.BTN_START);
    const hasScript = content.includes('wishlist-btn.js');

    if (!hasCss && !hasBtn && !hasScript) return `Skipped: ${key} has no wishlist code`;

    let patched = content;

    if (hasCss) {
      const s = patched.indexOf(this.CSS_START);
      const e = patched.indexOf(this.CSS_END) + this.CSS_END.length;
      patched = patched.slice(0, s) + patched.slice(e);
    }

    if (hasBtn) {
      const s = patched.indexOf(this.BTN_START);
      const e = patched.indexOf(this.BTN_END) + this.BTN_END.length;
      patched = patched.slice(0, s) + patched.slice(e);
    }

    if (hasScript) {
      patched = patched.replace(
        `  <script src="{{ 'wishlist-btn.js' | asset_url }}" defer></script>\n`,
        '',
      );
    }

    await this.uploadAsset(ctx, themeId, key, patched);
    return `Reverted: ${key}`;
  }

  private async deleteWishlistPage(ctx: InstallCtx): Promise<string> {
    const data = await this.shopifyFetch<{ pages: { id: number }[] }>(
      ctx,
      '/pages.json?handle=wishlist',
    );
    if (data.pages.length === 0) return 'Skipped: /pages/wishlist not found';

    const pageId = data.pages[0].id;
    await this.shopifyFetch(ctx, `/pages/${pageId}.json`, { method: 'DELETE' });
    return `Deleted: /pages/wishlist (id: ${pageId})`;
  }

  async install(shop: string): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];
    try {
      const { storeUrl } = await this.shopConfigService.getConfig(shop);
      const ctx: InstallCtx = { shop, storeUrl };

      const themeId = await this.getActiveThemeId(ctx);
      steps.push(`Active theme ID: ${themeId}`);

      await this.uploadAsset(ctx, themeId, 'assets/wishlist-btn.js', WISHLIST_BTN_JS);
      steps.push('Synced: assets/wishlist-btn.js');

      await this.uploadAsset(ctx, themeId, 'assets/wishlist-page.js', WISHLIST_PAGE_JS);
      steps.push('Synced: assets/wishlist-page.js');

      await this.uploadAsset(ctx, themeId, 'sections/wishlist-page.liquid', WISHLIST_PAGE_LIQUID);
      steps.push('Synced: sections/wishlist-page.liquid');

      await this.uploadAsset(
        ctx,
        themeId,
        'templates/page.wishlist.json',
        WISHLIST_PAGE_TEMPLATE_JSON,
      );
      steps.push('Synced: templates/page.wishlist.json');

      const patchResult = await this.patchMainProduct(ctx, themeId);
      steps.push(patchResult);

      steps.push(...(await this.mergeLocales(ctx, themeId)));

      const pageResult = await this.syncWishlistPage(ctx);
      steps.push(pageResult);

      const webhookResult = await this.syncWebhook(ctx);
      steps.push(webhookResult);

      await this.logInstallRun(shop, 'install', { success: true, steps });
      return { success: true, steps };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.logInstallRun(shop, 'install', { success: false, steps, error });
      throw err;
    }
  }

  async uninstall(shop: string): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];
    try {
      const { storeUrl } = await this.shopConfigService.getConfig(shop);
      const ctx: InstallCtx = { shop, storeUrl };

      const themeId = await this.getActiveThemeId(ctx);
      steps.push(`Active theme ID: ${themeId}`);

      await this.deleteAsset(ctx, themeId, 'assets/wishlist-btn.js');
      steps.push('Deleted: assets/wishlist-btn.js');

      await this.deleteAsset(ctx, themeId, 'assets/wishlist-page.js');
      steps.push('Deleted: assets/wishlist-page.js');

      await this.deleteAsset(ctx, themeId, 'sections/wishlist-page.liquid');
      steps.push('Deleted: sections/wishlist-page.liquid');

      await this.deleteAsset(ctx, themeId, 'templates/page.wishlist.json');
      steps.push('Deleted: templates/page.wishlist.json');

      const unpatchResult = await this.unpatchMainProduct(ctx, themeId);
      steps.push(unpatchResult);

      steps.push(...(await this.removeLocaleKeys(ctx, themeId)));

      const pageResult = await this.deleteWishlistPage(ctx);
      steps.push(pageResult);

      await this.logInstallRun(shop, 'uninstall', { success: true, steps });
      return { success: true, steps };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.logInstallRun(shop, 'uninstall', { success: false, steps, error });
      throw err;
    }
  }
}
