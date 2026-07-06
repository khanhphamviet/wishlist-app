import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { FastifyRequest } from 'fastify';
import { ShopConfigService } from '../shopify/shop-config.service';

/**
 * /install has no Shopify App Proxy context (it's admin-triggered, not
 * storefront traffic), so it needs its own lightweight auth: a shared
 * secret (INSTALL_SECRET) plus a valid, configured shop.
 */
@Injectable()
export class InstallAuthGuard implements CanActivate {
  constructor(private readonly shopConfigService: ShopConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const query = req.query as Record<string, string>;
    const headers = req.headers as Record<string, string>;

    const shop = query.shop;
    if (!shop) throw new UnauthorizedException('Missing shop');

    const providedKey = headers['x-install-secret'] || query.key;
    const expectedKey = process.env.INSTALL_SECRET;
    if (!expectedKey) throw new Error('INSTALL_SECRET is not configured in .env');
    if (!providedKey || !this.safeCompare(providedKey, expectedKey)) {
      throw new UnauthorizedException('Invalid install key');
    }

    try {
      await this.shopConfigService.getConfig(shop);
    } catch {
      throw new UnauthorizedException('Unknown shop');
    }

    (req as any).shopDomain = shop;
    return true;
  }

  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
