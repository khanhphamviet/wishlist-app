import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { InstallController } from './install.controller';
import { InstallService } from './install.service';

@Module({
  imports: [ShopifyModule],
  controllers: [InstallController],
  providers: [InstallService],
})
export class InstallModule {}
