export function createOrderController(orders) {
  return {
    create: async (req, res) => res.json(await orders.create(res.locals.uid, req.body ?? {})),
    current: async (_req, res) => res.json({ version: 1, order: await orders.current(res.locals.uid) }),
    get: async (req, res) => res.json(await orders.get(res.locals.uid, req.params.code)),
  };
}
