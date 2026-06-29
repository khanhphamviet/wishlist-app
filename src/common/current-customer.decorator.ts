import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  CanActivate,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

function resolveCustomerId(req: FastifyRequest): string | null {
  const query = req.query as Record<string, string>;
  return (
    (req as any).shopifyCustomerId || query?.logged_in_customer_id || query?.customer_id || null
  );
}

/**
 * Extracts the Shopify customer ID attached to the request by AppProxyGuard.
 * Usage in controllers: @CurrentCustomerId() customerId: string
 */
export const CurrentCustomerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const customerId = resolveCustomerId(req);
    Logger.log(`[CurrentCustomerId] resolved: ${customerId ?? 'null'}`, 'Auth');
    return customerId;
  },
);

/**
 * Guard that requires the customer to be logged in to access the wishlist.
 * Must run after AppProxyGuard (which attaches shopifyCustomerId to the request).
 */
@Injectable()
export class RequireLoginGuard implements CanActivate {
  private readonly logger = new Logger('Auth');

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const query = req.query as Record<string, string>;

    this.logger.debug(`[RequireLoginGuard] url: ${req.url}`);
    this.logger.debug(`[RequireLoginGuard] query params: ${JSON.stringify(query)}`);
    this.logger.debug(
      `[RequireLoginGuard] shopifyCustomerId (from guard): ${(req as any).shopifyCustomerId ?? 'undefined'}`,
    );
    this.logger.debug(
      `[RequireLoginGuard] logged_in_customer_id (from proxy): ${query?.logged_in_customer_id ?? 'undefined'}`,
    );
    this.logger.debug(
      `[RequireLoginGuard] customer_id (local test): ${query?.customer_id ?? 'undefined'}`,
    );

    const customerId = resolveCustomerId(req);
    this.logger.debug(
      `[RequireLoginGuard] resolved customerId: ${customerId ?? 'null'} → ${customerId ? 'ALLOW' : 'BLOCK'}`,
    );

    if (!customerId) {
      throw new UnauthorizedException('Please log in to use the wishlist');
    }
    return true;
  }
}
