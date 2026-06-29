import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentCustomerId,
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
@UseGuards(RequireLoginGuard)
export class WishlistController {
  private readonly logger = new Logger(WishlistController.name);

  constructor(private readonly wishlistService: WishlistService) {}

  @Get('list')
  async list(@CurrentCustomerId() customerId: string) {
    this.logger.log(`list → customerId: ${customerId}`);
    return this.wishlistService.list(customerId);
  }

  @Get('check')
  async check(
    @CurrentCustomerId() customerId: string,
    @Query('product_id') productId: string,
  ) {
    this.logger.log(`check → customerId: ${customerId}, productId: ${productId}`);
    const isWishlisted = await this.wishlistService.checkIsWishlisted(
      customerId,
      productId,
    );
    return { is_wishlisted: isWishlisted };
  }

  @Post('toggle')
  async toggle(
    @CurrentCustomerId() customerId: string,
    @Body('product_id') productId: string,
  ) {
    this.logger.log(`toggle → customerId: ${customerId}, productId: ${productId}`);
    const result = await this.wishlistService.toggle(customerId, productId);
    return { is_wishlisted: result.isWishlisted };
  }
}
