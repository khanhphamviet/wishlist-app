import { Injectable, Logger } from '@nestjs/common';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SHOPS_COLLECTION = 'shops';
const STORE_URL_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ShopConfig {
  shop: string;
  storeUrl: string;
  apiKey: string;
  apiSecret: string;
  disabledAt?: number;
}

@Injectable()
export class ShopConfigService {
  private readonly logger = new Logger(ShopConfigService.name);
  private storeUrlCache: { urls: string[]; expiresAt: number } | null = null;
  private storeUrlCacheInflight: Promise<string[]> | null = null;

  private get db() {
    if (getApps().length === 0) {
      initializeApp();
    }
    return getFirestore();
  }

  /**
   * Throws on missing/malformed config. Callers must convert this into a
   * generic UnauthorizedException (same message as a bad-HMAC failure) so an
   * attacker probing `shop=` can't distinguish "unknown shop" from "wrong signature".
   */
  async getConfig(shop: string): Promise<ShopConfig> {
    const snap = await this.db.collection(SHOPS_COLLECTION).doc(shop).get();
    const data = snap.data();

    if (!data || !data.storeUrl || !data.apiKey || !data.apiSecret) {
      throw new Error(`No shop config found for: ${shop}`);
    }

    return {
      shop,
      storeUrl: data.storeUrl,
      apiKey: data.apiKey,
      apiSecret: data.apiSecret,
      disabledAt: data.disabledAt,
    };
  }

  /**
   * Cached (5min TTL) list of all configured store URLs — used only for the
   * CORS origin check, where brief staleness is harmless. Every other lookup
   * (guards, token service) must stay uncached so a revoked secret takes
   * effect immediately.
   */
  async listStoreUrlsCached(): Promise<string[]> {
    if (this.storeUrlCache && this.storeUrlCache.expiresAt > Date.now()) {
      return this.storeUrlCache.urls;
    }
    if (this.storeUrlCacheInflight) {
      return this.storeUrlCacheInflight;
    }

    this.storeUrlCacheInflight = this.fetchStoreUrls().finally(() => {
      this.storeUrlCacheInflight = null;
    });
    return this.storeUrlCacheInflight;
  }

  private async fetchStoreUrls(): Promise<string[]> {
    const snap = await this.db.collection(SHOPS_COLLECTION).get();
    const urls = snap.docs
      .map((doc) => doc.data().storeUrl as string | undefined)
      .filter((url): url is string => Boolean(url));

    this.storeUrlCache = { urls, expiresAt: Date.now() + STORE_URL_CACHE_TTL_MS };
    return urls;
  }

  async markDisabled(shop: string): Promise<void> {
    await this.db
      .collection(SHOPS_COLLECTION)
      .doc(shop)
      .set({ disabledAt: Date.now() }, { merge: true });
    this.logger.log(`Marked shop disabled: ${shop}`);
  }
}
