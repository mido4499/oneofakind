import { serve } from '@hono/node-server';
import { createApp, optionsFromEnv, type AppOptions } from './app.js';

let options: AppOptions;
try {
  options = optionsFromEnv(process.env);
} catch (error) {
  console.error(`oneofakind: ${(error as Error).message}`);
  process.exit(1);
}

const app = createApp(options);
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST || undefined;

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`oneofakind listening on http://${hostname ?? 'localhost'}:${info.port}`);
});
