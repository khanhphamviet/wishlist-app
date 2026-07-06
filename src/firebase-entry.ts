import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './bootstrap';

// Module-level so it's reused across warm invocations on the same instance —
// this also keeps ShopifyAdminService's per-shop GraphQLClient cache warm.
let cachedApp: NestFastifyApplication | undefined;

async function getApp(): Promise<NestFastifyApplication> {
  if (!cachedApp) {
    cachedApp = await createApp();
    await cachedApp.init(); // no .listen() — no port binding in Cloud Functions
  }
  return cachedApp;
}

// timeoutSeconds: /install runs ~15-20 sequential Shopify API calls; 120s
// gives generous headroom including cold start. memory: 512MiB is generous
// for an I/O-bound proxy but avoids a second round of tuning.
export const api = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120, concurrency: 40 },
  async (req, res) => {
    const app = await getApp();
    const instance = app.getHttpAdapter().getInstance();
    await instance.ready();
    instance.server.emit('request', req, res);
  },
);
