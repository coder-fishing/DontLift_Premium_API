import { Router } from 'express';
import { createAuthenticateFirebase } from '../middleware/authenticate-firebase.js';
import { createOrderController } from '../controllers/orderController.js';

export function createPremiumOrderRouter({ verifyToken, orders }) {
  const router = Router();
  router.use(createAuthenticateFirebase(verifyToken));
  const controller = createOrderController(orders);

  router.post('/', controller.create);
  router.get('/current', controller.current);
  router.get('/:code', controller.get);
  return router;
}
