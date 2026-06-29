import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  verifyHmac(rawBody: Buffer, hmacHeader: string): void {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) throw new Error('SHOPIFY_API_SECRET is not configured in .env');

    const computed = createHmac('sha256', secret).update(rawBody).digest('base64');

    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(hmacHeader, 'utf8');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook HMAC signature');
    }
  }

  handleAppUninstalled(shop: string): void {
    this.logger.log(`App uninstalled by shop: ${shop}`);
    // Note: the access token is revoked at this point — Shopify API calls will fail.
    // Use this handler to clean up any local records (database, cache, etc.).
    // Theme cleanup (JS/Liquid files) must be done via DELETE /install before uninstalling.
  }
}
