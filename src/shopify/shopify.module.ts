import { Module } from '@nestjs/common';
import { ShopConfigService } from './shop-config.service';
import { ShopifyAdminService } from './shopify-admin.service';
import { ShopifyTokenService } from './shopify-token.service';

@Module({
  providers: [ShopConfigService, ShopifyTokenService, ShopifyAdminService],
  exports: [ShopConfigService, ShopifyTokenService, ShopifyAdminService],
})
export class ShopifyModule {}
