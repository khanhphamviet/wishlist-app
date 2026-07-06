import { Injectable, Logger } from '@nestjs/common';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ShopConfigService } from './shop-config.service';

const tokenDocPath = (shop: string) => `shopify_tokens/${shop}`;

@Injectable()
export class ShopifyTokenService {
  private readonly logger = new Logger(ShopifyTokenService.name);

  constructor(private readonly shopConfigService: ShopConfigService) {}

  private get db() {
    if (getApps().length === 0) {
      initializeApp();
    }
    return getFirestore();
  }

  async getToken(shop: string): Promise<string> {
    const snap = await this.db.doc(tokenDocPath(shop)).get();
    const cached = snap.data()?.token as string | undefined;
    if (cached) return cached;
    return this.refreshToken(shop);
  }

  async deleteToken(shop: string): Promise<void> {
    await this.db.doc(tokenDocPath(shop)).delete();
  }

  async refreshToken(shop: string): Promise<string> {
    this.logger.warn(`Access token rejected — refreshing via client_credentials for ${shop}`);
    const token = await this.fetchToken(shop);
    await this.db.doc(tokenDocPath(shop)).set({ token, updatedAt: Date.now() });
    return token;
  }

  private async fetchToken(shop: string): Promise<string> {
    const { apiKey, apiSecret, storeUrl } = await this.shopConfigService.getConfig(shop);

    const res = await fetch(`${storeUrl}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: apiKey,
        client_secret: apiSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch access token: ${text}`);
    }

    const data = (await res.json()) as { access_token: string };
    this.logger.log(`Access token refreshed successfully for ${shop}`);
    return data.access_token;
  }
}
