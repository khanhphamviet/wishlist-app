import { Module } from '@nestjs/common';
import { AppProxyGuard } from '../common/app-proxy.guard';
import { ShopifyModule } from '../shopify/shopify.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [ShopifyModule],
  controllers: [WishlistController],
  providers: [WishlistService, AppProxyGuard],
})
export class WishlistModule {}
