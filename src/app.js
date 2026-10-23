import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { createRootRouter } from './routes/root.js';
import { createHealthRouter } from './routes/health.js';
import { createPackageRouter } from './routes/packages.js';
import { createCheckoutRouter } from './routes/checkout.js';
import { createWebhookRouter } from './routes/webhooks.js';
import { createPremiumOrderRouter } from './routes/premium-orders.js';

export function createApp({ verifyToken, orders, webhook, webOrigin = '' }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.on('finish', () => {
      console.info(`[api] ${req.method} ${req.path} -> ${res.statusCode} ${res.getHeader('content-type') ?? ''}`);
    });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin && req.headers.origin === webOrigin) {
      res.set('Access-Control-Allow-Origin', webOrigin).set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.use('/', createRootRouter());
  app.use('/health', createHealthRouter());
  app.use('/v1/premium/packages', createPackageRouter());
  app.use('/checkout', createCheckoutRouter());
  app.use('/webhooks', createWebhookRouter(webhook));
  app.use('/v1/premium/orders', createPremiumOrderRouter({ verifyToken, orders }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
