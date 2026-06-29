import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ShopifyTokenService {
  private readonly logger = new Logger(ShopifyTokenService.name);
  private token: string | null = null;

  async getToken(): Promise<string> {
    if (!this.token) {
      this.token = await this.fetchToken();
    }
    return this.token;
  }

  async refreshToken(): Promise<string> {
    this.logger.warn('Access token rejected — refreshing via client_credentials');
    this.token = await this.fetchToken();
    return this.token;
  }

  private async fetchToken(): Promise<string> {
    const clientId = process.env.SHOPIFY_API_KEY;
    const clientSecret = process.env.SHOPIFY_API_SECRET;
    const storeUrl = process.env.SHOPIFY_STORE_URL;

    if (!clientId || !clientSecret) {
      throw new Error(
        'SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required to auto-refresh the access token',
      );
    }

    const res = await fetch(`${storeUrl}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch access token: ${text}`);
    }

    const data = await res.json() as { access_token: string };
    this.logger.log('Access token refreshed successfully');
    return data.access_token;
  }
}
