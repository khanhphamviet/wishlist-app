import { Injectable, Logger } from '@nestjs/common';
import {
  WISHLIST_BTN_CSS,
  WISHLIST_BTN_HTML,
  WISHLIST_BTN_JS,
  WISHLIST_PAGE_JS,
  WISHLIST_PAGE_LIQUID,
  WISHLIST_PAGE_TEMPLATE_JSON,
} from './assets';

@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);
  private readonly storeUrl = process.env.SHOPIFY_STORE_URL!;
  private readonly accessToken = process.env.SHOPIFY_ACCESS_TOKEN!;
  private readonly apiVersion = '2026-04';

  private async shopifyFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.storeUrl}/admin/api/${this.apiVersion}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });
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

  private async patchMainProduct(themeId: string): Promise<string> {
    const key = 'sections/main-product.liquid';
    const content = await this.getAsset(themeId, key);
    if (!content) return `Skipped: ${key} not found in theme`;

    const alreadyHasButton = content.includes('wishlist-btn--overlay');
    const alreadyHasScript = content.includes('wishlist-btn.js');

    if (alreadyHasButton && alreadyHasScript) {
      return `Skipped: ${key} already patched`;
    }

    let patched = content;

    // Inject button CSS into the first {%- style -%} block
    if (!alreadyHasButton) {
      patched = patched.replace('{%- endstyle -%}', `${WISHLIST_BTN_CSS}{%- endstyle -%}`);
    }

    // Inject button HTML after the product-media-gallery render tag
    if (!alreadyHasButton) {
      const galleryTag = `{% render 'product-media-gallery'`;
      const idx = patched.indexOf(galleryTag);
      if (idx !== -1) {
        const tagEnd = patched.indexOf('%}', idx) + 2;
        patched = patched.slice(0, tagEnd) + WISHLIST_BTN_HTML + patched.slice(tagEnd);
      }
    }

    // Inject script tag before </product-info>
    if (!alreadyHasScript) {
      patched = patched.replace(
        '</product-info>',
        `  <script src="{{ 'wishlist-btn.js' | asset_url }}" defer></script>\n</product-info>`,
      );
    }

    await this.uploadAsset(themeId, key, patched);
    return `Patched: ${key}`;
  }

  private async ensureWebhook(): Promise<string> {
    const appUrl = process.env.APP_URL;
    if (!appUrl) return 'Skipped: APP_URL not set in .env';

    const address = `${appUrl}/webhooks/app/uninstalled`;

    const existing = await this.shopifyFetch<{ webhooks: { id: number; address: string }[] }>(
      '/webhooks.json?topic=app%2Funinstalled',
    );

    if (existing.webhooks.some((w) => w.address === address)) {
      return `Skipped: webhook already registered (${address})`;
    }

    await this.shopifyFetch('/webhooks.json', {
      method: 'POST',
      body: JSON.stringify({
        webhook: { topic: 'app/uninstalled', address, format: 'json' },
      }),
    });

    return `Registered webhook: ${address}`;
  }

  private async ensureWishlistPage(): Promise<string> {
    const data = await this.shopifyFetch<{ pages: { id: number }[] }>('/pages.json?handle=wishlist');
    if (data.pages.length > 0) return 'Skipped: /pages/wishlist already exists';

    await this.shopifyFetch('/pages.json', {
      method: 'POST',
      body: JSON.stringify({
        page: { title: 'Wishlist', handle: 'wishlist', template_suffix: 'wishlist' },
      }),
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

    const hasButton = content.includes('wishlist-btn--overlay');
    const hasScript = content.includes('wishlist-btn.js');

    if (!hasButton && !hasScript) return `Skipped: ${key} has no wishlist code`;

    let patched = content;

    if (hasButton) {
      patched = patched.replace(WISHLIST_BTN_CSS, '');
      patched = patched.replace(WISHLIST_BTN_HTML, '');
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

    const pageResult = await this.deleteWishlistPage();
    steps.push(pageResult);

    return { success: true, steps };
  }

  async update(): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];

    const themeId = await this.getActiveThemeId();
    steps.push(`Active theme ID: ${themeId}`);

    await this.uploadAsset(themeId, 'assets/wishlist-btn.js', WISHLIST_BTN_JS);
    steps.push('Updated: assets/wishlist-btn.js');

    await this.uploadAsset(themeId, 'assets/wishlist-page.js', WISHLIST_PAGE_JS);
    steps.push('Updated: assets/wishlist-page.js');

    await this.uploadAsset(themeId, 'sections/wishlist-page.liquid', WISHLIST_PAGE_LIQUID);
    steps.push('Updated: sections/wishlist-page.liquid');

    return { success: true, steps };
  }

  async install(): Promise<{ success: boolean; steps: string[] }> {
    const steps: string[] = [];

    const themeId = await this.getActiveThemeId();
    steps.push(`Active theme ID: ${themeId}`);

    await this.uploadAsset(themeId, 'assets/wishlist-btn.js', WISHLIST_BTN_JS);
    steps.push('Uploaded: assets/wishlist-btn.js');

    await this.uploadAsset(themeId, 'assets/wishlist-page.js', WISHLIST_PAGE_JS);
    steps.push('Uploaded: assets/wishlist-page.js');

    await this.uploadAsset(themeId, 'sections/wishlist-page.liquid', WISHLIST_PAGE_LIQUID);
    steps.push('Uploaded: sections/wishlist-page.liquid');

    await this.uploadAsset(themeId, 'templates/page.wishlist.json', WISHLIST_PAGE_TEMPLATE_JSON);
    steps.push('Uploaded: templates/page.wishlist.json');

    const patchResult = await this.patchMainProduct(themeId);
    steps.push(patchResult);

    const pageResult = await this.ensureWishlistPage();
    steps.push(pageResult);

    const webhookResult = await this.ensureWebhook();
    steps.push(webhookResult);

    return { success: true, steps };
  }
}
