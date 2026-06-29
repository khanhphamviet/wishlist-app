import { Module } from '@nestjs/common';
import { ShopifyAdminService } from './shopify-admin.service';
import { ShopifyTokenService } from './shopify-token.service';

@Module({
  providers: [ShopifyTokenService, ShopifyAdminService],
  exports: [ShopifyTokenService, ShopifyAdminService],
})
export class ShopifyModule {}
