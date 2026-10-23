import { existsSync } from 'node:fs';
import { readConfig } from './config/env.js';
import { createFirebase } from './providers/firebaseAdmin.js';
import { createPayOS } from './providers/payosClient.js';
import { createOrderStore } from './repositories/orderRepository.js';
import { createOrderService } from './services/orderService.js';
import { createWebhookService } from './services/webhookService.js';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = readConfig(process.env);
const { db, verifyToken } = createFirebase(config);
const payos = createPayOS(config);
const store = createOrderStore(db);
const app = createApp({ verifyToken, orders: createOrderService(store, payos, config.publicBaseUrl),
  webhook: createWebhookService(store, payos), webOrigin: config.webOrigin });
const server = app.listen(config.port, '0.0.0.0', error => {
  if (error) {
    console.error(`Cannot start Premium API on port ${config.port}: ${error.code ?? error.message}`);
    process.exit(1);
  }
  console.info(`Premium API listening at http://localhost:${config.port}`);
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
