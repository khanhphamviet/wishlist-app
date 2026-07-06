import { createApp } from './bootstrap';

async function bootstrap() {
  const app = await createApp();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Wishlist app running on port ${port}`);
}

bootstrap();
