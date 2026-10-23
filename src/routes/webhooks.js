import { Router } from 'express';
import { createWebhookController } from '../controllers/webhookController.js';

export function createWebhookRouter(webhook) {
  const router = Router();
  router.post('/payos', createWebhookController(webhook));
  return router;
}
