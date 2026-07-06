import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { InstallAuthGuard } from './install-auth.guard';
import { InstallController } from './install.controller';
import { InstallService } from './install.service';

@Module({
  imports: [ShopifyModule],
  controllers: [InstallController],
  providers: [InstallService, InstallAuthGuard],
})
export class InstallModule {}
