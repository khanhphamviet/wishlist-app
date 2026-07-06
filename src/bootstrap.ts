import fastifyView from '@fastify/view';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as handlebars from 'handlebars';
import { join } from 'path';
import { Readable } from 'stream';
import { AppModule } from './app.module';
import { ShopConfigService } from './shopify/shop-config.service';

/**
 * Builds and configures the Nest+Fastify app, but does not start listening —
 * callers decide how to serve it (plain `app.listen()` locally, or bridged
 * into a Cloud Functions `onRequest` handler in production).
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  // Capture raw body for Shopify webhook/App-Proxy HMAC verification.
  // Uses preParsing hook instead of addContentTypeParser to avoid
  // conflicting with NestJS's built-in application/json parser.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('preParsing', async (request: any, _reply: any, payload: any) => {
      // Cloud Functions' onRequest handler pre-buffers the body and attaches it
      // to the raw IncomingMessage before bridging into Fastify via
      // `server.emit('request', req, res)` — reuse those bytes if present,
      // since the underlying stream has already been consumed in that case.
      // Falls back to manual stream collection for plain `fastify.listen()` (local dev).
      const preBuffered = request.raw?.rawBody as Buffer | undefined;
      let rawBody: Buffer;
      if (preBuffered) {
        rawBody = preBuffered;
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of payload) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        rawBody = Buffer.concat(chunks);
      }
      request.rawBody = rawBody;

      const stream = new Readable();
      stream.push(rawBody);
      stream.push(null);
      return stream;
    });

  // Cast needed due to Fastify version mismatch between @nestjs/platform-fastify and @fastify/view.
  await app.register(fastifyView as any, {
    engine: { handlebars },
    root: join(process.cwd(), 'views'),
    defaultContext: {},
  });

  // App Proxy requests come from each store's storefront domain, not
  // admin.shopify.com, so CORS must allow every configured store's origin.
  const shopConfigService = app.get(ShopConfigService);
  app.enableCors({
    // @fastify/cors detects an async origin function by its return value being
    // a thenable — it must NOT also invoke the callback, or the callback fires
    // twice (once with our result, once with the function's own `undefined`
    // return), and the second call trips its "Invalid CORS origin option" error.
    origin: async (origin: string | undefined) => {
      if (!origin) return true;
      const allowed = await shopConfigService.listStoreUrlsCached();
      return allowed.includes(origin);
    },
    methods: ['GET', 'POST'],
  });

  return app;
}
