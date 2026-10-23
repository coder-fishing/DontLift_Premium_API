export function createWebhookController(webhook) {
  return async (req, res) => {
    await webhook(req.body);
    res.json({ success: true });
  };
}
