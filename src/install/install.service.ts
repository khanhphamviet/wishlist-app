import { Injectable, Logger } from '@nestjs/common';
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
  { key: 'locales/ja.json',         content: () => WISHLIST_LOCALE_JA },
  { key: 'locales/zh-TW.json',      content: () => WISHLIST_LOCALE_ZH_TW },
  { key: 'locales/ko.json',         content: () => WISHLIST_LOCALE_KO },
];

@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);
  private readonly storeUrl = process.env.SHOPIFY_STORE_URL!;
  private readonly apiVersion = '2026-04';

  constructor(private readonly tokenService: ShopifyTokenService) {}

  private async shopifyFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.storeUrl}/admin/api/${this.apiVersion}${path}`;

    const doFetch = async (token: string) =>
      fetch(url, {
        ...options,
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        },
      });

    let res = await doFetch(await this.tokenService.getToken());

    if (res.status === 401) {
      res = await doFetch(await this.tokenService.refreshToken());
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify ${res.status} on ${path}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private async getActiveThemeId(): Promise<string> {
    const data = await this.shopifyFetch<{ themes: { id: number; role: string }[] }>('/themes.json');
    const theme = data.themes.find((t) => t.role === 'main');
    if (!theme) throw new Error('No active theme found');
    return String(theme.id);
  }

  private async uploadAsset(themeId: string, key: string, value: string): Promise<void> {
    await this.shopifyFetch(`/themes/${themeId}/assets.json`, {
      method: 'PUT',
      body: JSON.stringify({ asset: { key, value } }),
    });
    this.logger.log(`Uploaded: ${key}`);
  }

  private async getAsset(themeId: string, key: string): Promise<string | null> {
    try {
      const data = await this.shopifyFetch<{ asset: { value: string } }>(
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

  private async mergeLocales(themeId: string): Promise<string[]> {
    const results: string[] = [];
    for (const { key, content } of LOCALES) {
      const existing = await this.getAsset(themeId, key);
      const wishlistKeys = JSON.parse(content());
      const merged = existing
        ? this.deepMerge(JSON.parse(existing), wishlistKeys)
        : wishlistKeys;
      await this.uploadAsset(themeId, key, JSON.stringify(merged, null, 2));
      results.push(`Merged locale keys: ${key}`);
    }
    return results;
  }

  private async removeLocaleKeys(themeId: string): Promise<string[]> {
    const results: string[] = [];
    for (const { key } of LOCALES) {
      const existing = await this.getAsset(themeId, key);
      if (!existing) { results.push(`Skipped: ${key} not found`); continue; }

      const current = JSON.parse(existing);
      if (!current.wishlist) { results.push(`Skipped: no wishlist keys in ${key}`); continue; }

      delete current.wishlist;
      await this.uploadAsset(themeId, key, JSON.stringify(current, null, 2));
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

  private async patchMainProduct(themeId: string): Promise<string> {
    const key = 'sections/main-product.liquid';
    const content = await this.getAsset(themeId, key);
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

    await this.uploadAsset(themeId, key, patched);
    return `Patched: ${key}`;
  }

  private async syncWebhook(): Promise<string> {
    const appUrl = process.env.APP_URL;
    if (!appUrl) return 'Skipped: APP_URL not set in .env';

    const address = `${appUrl}/webhooks/app/uninstalled`;

    const existing = await this.shopifyFetch<{ webhooks: { id: number; address: string }[] }>(
      '/webhooks.json?topic=app%2Funinstalled',
    );

    // Delete stale webhooks pointing at a different URL (e.g. old ngrok address)
    for (const w of existing.webhooks) {
      if (w.address !== address) {
        await this.shopifyFetch(`/webhooks/${w.id}.json`, { method: 'DELETE' });
      }
    }

    // Create if not already registered at the current address
    if (!existing.webhooks.some((w) => w.address === address)) {
      await this.shopifyFetch('/webhooks.json', {
        method: 'POST',
        body: JSON.stringify({
          webhook: { topic: 'app/uninstalled', address, format: 'json' },
        }),
      });
    }

    return `Synced webhook: ${address}`;
  }

  private async syncWishlistPage(): Promise<string> {
    const data = await this.shopifyFetch<{ pages: { id: number }[] }>('/pages.json?handle=wishlist');
    const page = { title: 'Wishlist', handle: 'wishlist', template_suffix: 'wishlist' };

    if (data.pages.length > 0) {
      const pageId = data.pages[0].id;
      await this.shopifyFetch(`/pages/${pageId}.json`, {
        method: 'PUT',
        body: JSON.stringify({ page }),
      });
      return 'Synced: /pages/wishlist';
    }

    await this.shopifyFetch('/pages.json', {
      method: 'POST',
      body: JSON.stringify({ page }),
    });
    return 'Created: /pages/wishlist';
  }

  private async deleteAsset(themeId: string, key: string): Promise<void> {
    try {
      await this.shopifyFetch(
        `/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      this.logger.log(`Deleted: ${key}`);
    } catch {
      this.logger.warn(`Skipped delete (not found): ${key}`);
    }
  }

  private async unpatchMainProduct(themeId: string): Promise<string> {
    const key = 'sections/main-product.liquid';
    const content = await this.getAsset(themeId, key);
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

    await this.uploadAsset(themeId, key, patched);
    return `Reverted: ${key}`;
  }

  private async deleteWishlistPage(): Promise<string> {
    const data = await this.shopifyFetch<{ pages: { id: number }[] }>('/pages.json?handle=wishlist');
    if (data.pages.length === 0) return 'Skipped: /pages/wishlist not found';

    const pageId = data.pages[0].id;
    await this.shopifyFetch(`/pages/${pageId}.json`, { method: 'DELETE' });
    return `Deleted: /pages/wishlist (id: ${pageId})`;
  }

  async install(): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];

    const themeId = await this.getActiveThemeId();
    steps.push(`Active theme ID: ${themeId}`);

    await this.uploadAsset(themeId, 'assets/wishlist-btn.js', WISHLIST_BTN_JS);
    steps.push('Synced: assets/wishlist-btn.js');

    await this.uploadAsset(themeId, 'assets/wishlist-page.js', WISHLIST_PAGE_JS);
    steps.push('Synced: assets/wishlist-page.js');

    await this.uploadAsset(themeId, 'sections/wishlist-page.liquid', WISHLIST_PAGE_LIQUID);
    steps.push('Synced: sections/wishlist-page.liquid');

    await this.uploadAsset(themeId, 'templates/page.wishlist.json', WISHLIST_PAGE_TEMPLATE_JSON);
    steps.push('Synced: templates/page.wishlist.json');

    const patchResult = await this.patchMainProduct(themeId);
    steps.push(patchResult);

    steps.push(...await this.mergeLocales(themeId));

    const pageResult = await this.syncWishlistPage();
    steps.push(pageResult);

    const webhookResult = await this.syncWebhook();
    steps.push(webhookResult);

    return { success: true, steps };
  }

  async uninstall(): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];

    const themeId = await this.getActiveThemeId();
    steps.push(`Active theme ID: ${themeId}`);

    await this.deleteAsset(themeId, 'assets/wishlist-btn.js');
    steps.push('Deleted: assets/wishlist-btn.js');

    await this.deleteAsset(themeId, 'assets/wishlist-page.js');
    steps.push('Deleted: assets/wishlist-page.js');

    await this.deleteAsset(themeId, 'sections/wishlist-page.liquid');
    steps.push('Deleted: sections/wishlist-page.liquid');

    await this.deleteAsset(themeId, 'templates/page.wishlist.json');
    steps.push('Deleted: templates/page.wishlist.json');

    const unpatchResult = await this.unpatchMainProduct(themeId);
    steps.push(unpatchResult);

    steps.push(...await this.removeLocaleKeys(themeId));

    const pageResult = await this.deleteWishlistPage();
    steps.push(pageResult);

    return { success: true, steps };
  }
}
