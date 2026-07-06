import { Module } from '@nestjs/common';
import { ShopifyModule } from '../shopify/shopify.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [ShopifyModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
