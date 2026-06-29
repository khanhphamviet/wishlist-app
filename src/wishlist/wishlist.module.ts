import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [ShopifyModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
