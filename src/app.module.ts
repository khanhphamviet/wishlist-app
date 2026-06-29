import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InstallModule } from './install/install.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WishlistModule } from './wishlist/wishlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WishlistModule,
    InstallModule,
    WebhooksModule,
  ],
})
export class AppModule {}
