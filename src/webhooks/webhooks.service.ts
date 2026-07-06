import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ShopConfigService } from '../shopify/shop-config.service';
import { ShopifyTokenService } from '../shopify/shopify-token.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly shopConfigService: ShopConfigService,
    private readonly tokenService: ShopifyTokenService,
  ) {}

  async verifyHmac(shop: string, rawBody: Buffer, hmacHeader: string): Promise<void> {
    let apiSecret: string;
    try {
      apiSecret = (await this.shopConfigService.getConfig(shop)).apiSecret;
    } catch {
      throw new UnauthorizedException('Invalid webhook HMAC signature');
    }

    const computed = createHmac('sha256', apiSecret).update(rawBody).digest('base64');

    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(hmacHeader, 'utf8');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook HMAC signature');
    }
  }

  async handleAppUninstalled(shop: string): Promise<void> {
    this.logger.log(`App uninstalled by shop: ${shop}`);
    // Not required by Shopify — app/uninstalled is only mandatory for App Store listings,
    // and this app isn't published. Still wired in so multi-store cleanup happens:
    // drop the cached token (revoked on uninstall anyway) and mark the shop config
    // disabled without deleting it, so a reinstall doesn't require re-entering credentials.
    await this.tokenService.deleteToken(shop);
    await this.shopConfigService.markDisabled(shop);
    // Theme cleanup (JS/Liquid files) must be done via DELETE /install before uninstalling.
  }
}
