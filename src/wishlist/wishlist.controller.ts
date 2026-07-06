import { Body, Controller, Get, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { AppProxyGuard } from '../common/app-proxy.guard';
import {
  CurrentCustomerId,
  CurrentShop,
  RequireLoginGuard,
} from '../common/current-customer.decorator';
import { WishlistService } from './wishlist.service';

/**
 * Routes for the Shopify App Proxy setup:
 *   Subpath prefix: apps
 *   Subpath: wishlist
 *   Proxy URL: https://<your-backend-domain>/wishlist
 *
 * When a customer visits /apps/wishlist/list on the storefront,
 * Shopify forwards the request to https://<backend>/wishlist/list
 */
@Controller('wishlist')
@UseGuards(AppProxyGuard, RequireLoginGuard)
export class WishlistController {
  private readonly logger = new Logger(WishlistController.name);

  constructor(private readonly wishlistService: WishlistService) {}

  @Get('list')
  async list(@CurrentShop() shop: string, @CurrentCustomerId() customerId: string) {
    this.logger.log(`list → shop: ${shop}, customerId: ${customerId}`);
    return this.wishlistService.list(shop, customerId);
  }

  @Get('check')
  async check(
    @CurrentShop() shop: string,
    @CurrentCustomerId() customerId: string,
    @Query('product_id') productId: string,
  ) {
    this.logger.log(`check → shop: ${shop}, customerId: ${customerId}, productId: ${productId}`);
    const isWishlisted = await this.wishlistService.checkIsWishlisted(shop, customerId, productId);
    return { is_wishlisted: isWishlisted };
  }

  @Post('toggle')
  async toggle(
    @CurrentShop() shop: string,
    @CurrentCustomerId() customerId: string,
    @Body('product_id') productId: string,
  ) {
    this.logger.log(`toggle → shop: ${shop}, customerId: ${customerId}, productId: ${productId}`);
    const result = await this.wishlistService.toggle(shop, customerId, productId);
    return { is_wishlisted: result.isWishlisted };
  }
}
