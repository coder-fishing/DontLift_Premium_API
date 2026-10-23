import { ApiError } from '../domain/apiError.js';

export function createAuthenticateFirebase(verifyToken) {
  return async (req, res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw new ApiError('unauthenticated', 401);

    let decoded;
    try {
      decoded = await verifyToken(header.slice(7));
    } catch {
      throw new ApiError('unauthenticated', 401);
    }

    if (!decoded?.uid) throw new ApiError('unauthenticated', 401);
    res.locals.uid = decoded.uid;
    next();
  };
}
