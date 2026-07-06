import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { FastifyRequest } from 'fastify';
import { ShopConfigService } from '../shopify/shop-config.service';

/**
 * Verifies that requests genuinely originate from the Shopify App Proxy.
 *
 * Shopify signs the entire query string (excluding the "signature" param)
 * using the App Secret (HMAC-SHA256). Keys are sorted alphabetically and
 * concatenated as key=value pairs with no separator between them:
 *
 *   key1=value1key2=value2...
 *
 * Multi-store: the App Secret is per-shop, so the (untrusted) `shop` query
 * param must be resolved to a shop config first, then verified against that
 * shop's secret. Unknown-shop and bad-signature failures use the same
 * generic message so a caller can't distinguish the two.
 *
 * Reference: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#calculate-a-digital-signature
 */
@Injectable()
export class AppProxyGuard implements CanActivate {
  constructor(private readonly shopConfigService: ShopConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const query = { ...(req.query as Record<string, string>) };

    const signature = query.signature;
    const shop = query.shop;
    if (!signature || !shop) {
      throw new UnauthorizedException('Invalid signature');
    }
    delete query.signature;

    let apiSecret: string;
    try {
      apiSecret = (await this.shopConfigService.getConfig(shop)).apiSecret;
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    // Sort keys alphabetically and concatenate "key=value" pairs with no separator
    const sortedParams = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('');

    const computedSignature = createHmac('sha256', apiSecret).update(sortedParams).digest('hex');

    const isValid = this.safeCompare(computedSignature, signature);

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Attach customer_id (if logged in) and shop to the request for use in controllers
    (req as any).shopifyCustomerId = query.logged_in_customer_id || null;
    (req as any).shopDomain = shop;

    return true;
  }

  /** Constant-time string comparison to prevent timing attacks */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
