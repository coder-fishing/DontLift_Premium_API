import { ApiError } from '../domain/apiError.js';

export function errorHandler(error, _req, res, _next) {
  const status = error instanceof ApiError
    ? error.status
    : error.type === 'entity.too.large' ? 413
      : error instanceof SyntaxError ? 400 : 503;
  const code = error instanceof ApiError
    ? error.code
    : status === 400 ? 'invalid-argument' : 'unavailable';
  res.status(status).json({ version: 1, code });
}
