import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  // Optional — app/uninstalled is only mandatory for App Store listings, and this app
  // isn't published. Registered anyway (see InstallService.syncWebhook) so uninstalls
  // are logged and trigger per-shop cleanup in WebhooksService.
  @Post('app/uninstalled')
  @HttpCode(200)
  async appUninstalled(
    @Req() req: FastifyRequest,
    @Headers('x-shopify-hmac-sha256') hmac: string,
    @Headers('x-shopify-shop-domain') shop: string,
  ) {
    if (!hmac) throw new UnauthorizedException('Missing HMAC header');
    if (!shop) throw new UnauthorizedException('Missing shop domain header');

    const rawBody = (req as any).rawBody as Buffer;
    // The shop must come from the header (used to pick the right secret before
    // verification), not the body — the body is untrusted until HMAC passes.
    await this.webhooksService.verifyHmac(shop, rawBody, hmac);

    await this.webhooksService.handleAppUninstalled(shop);

    return { received: true };
  }
}
