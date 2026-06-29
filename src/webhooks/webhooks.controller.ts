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

  @Post('app/uninstalled')
  @HttpCode(200)
  appUninstalled(
    @Req() req: FastifyRequest,
    @Headers('x-shopify-hmac-sha256') hmac: string,
  ) {
    if (!hmac) throw new UnauthorizedException('Missing HMAC header');

    const rawBody = (req as any).rawBody as Buffer;
    this.webhooksService.verifyHmac(rawBody, hmac);

    const body = req.body as { domain?: string; myshopify_domain?: string };
    const shop = body.myshopify_domain ?? body.domain ?? 'unknown';

    this.webhooksService.handleAppUninstalled(shop);

    return { received: true };
  }
}
