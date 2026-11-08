import { Router, raw } from 'express';
import { createAuthenticateFirebase } from '../middleware/authenticate-firebase.js';
import { createAvatarController } from '../controllers/avatarController.js';

export function createProfileRouter({ verifyToken, avatars }) {
  const router = Router();
  router.use(createAuthenticateFirebase(verifyToken));
  const controller = createAvatarController(avatars);
  router.post('/avatar', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), controller.upload);
  router.delete('/avatar', controller.remove);
  return router;
}
