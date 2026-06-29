import fastifyView from '@fastify/view';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as handlebars from 'handlebars';
import { join } from 'path';
import { Readable } from 'stream';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // Capture raw body for Shopify webhook HMAC verification.
  // Uses preParsing hook instead of addContentTypeParser to avoid
  // conflicting with NestJS's built-in application/json parser.
  app.getHttpAdapter().getInstance().addHook(
    'preParsing',
    async (_req: any, _reply: any, payload: any) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks);
      _req.rawBody = rawBody;

      const stream = new Readable();
      stream.push(rawBody);
      stream.push(null);
      return stream;
    },
  );

  // Cast needed due to Fastify version mismatch between @nestjs/platform-fastify and @fastify/view.
  await app.register(fastifyView as any, {
    engine: { handlebars },
    root: join(process.cwd(), 'views'),
    defaultContext: {},
  });

  // App Proxy requests come from the Shopify storefront domain (myshop.com),
  // not from admin.shopify.com, so CORS must be enabled for the store domain.
  app.enableCors({
    origin: process.env.SHOPIFY_STORE_URL
      ? [process.env.SHOPIFY_STORE_URL]
      : true,
    methods: ['GET', 'POST'],
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Wishlist app running on port ${port}`);
}

bootstrap();
