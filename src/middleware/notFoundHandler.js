export function notFoundHandler(_req, res) {
  res.status(404).json({ version: 1, code: 'not-found' });
}
