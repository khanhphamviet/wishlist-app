import { Module } from '@nestjs/common';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { ShopifyAdminService } from '../shopify/shopify-admin.service';

@Module({
  controllers: [WishlistController],
  providers: [WishlistService, ShopifyAdminService],
})
export class WishlistModule {}
