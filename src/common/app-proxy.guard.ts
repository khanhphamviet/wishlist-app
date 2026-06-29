import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { FastifyRequest } from 'fastify';

/**
 * Verifies that requests genuinely originate from the Shopify App Proxy.
 *
 * Shopify signs the entire query string (excluding the "signature" param)
 * using the App Secret (HMAC-SHA256). Keys are sorted alphabetically and
 * concatenated as key=value pairs with no separator between them:
 *
 *   key1=value1key2=value2...
 *
 * Reference: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#calculate-a-digital-signature
 */
@Injectable()
export class AppProxyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const query = { ...(req.query as Record<string, string>) };

    const signature = query.signature;
    if (!signature) {
      throw new UnauthorizedException('Missing signature');
    }
    delete query.signature;

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      throw new Error('SHOPIFY_API_SECRET is not configured in .env');
    }

    // Sort keys alphabetically and concatenate "key=value" pairs with no separator
    const sortedParams = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('');

    const computedSignature = createHmac('sha256', secret)
      .update(sortedParams)
      .digest('hex');

    const isValid = this.safeCompare(computedSignature, signature);

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Attach customer_id (if logged in) to the request for use in controllers
    (req as any).shopifyCustomerId = query.logged_in_customer_id || null;
    (req as any).shopDomain = query.shop || null;

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
