export function createOrderController(orders) {
  return {
    create: async (req, res) => res.json(await orders.create(res.locals.uid, req.body ?? {})),
    current: async (req, res) => res.json({ version: 1, order: await orders.current(res.locals.uid, req.query.refresh === '1') }),
    cancelCurrent: async (req, res) => res.json({ version: 1, order: await orders.cancelCurrent(res.locals.uid, req.body ?? {}) }),
    get: async (req, res) => res.json(await orders.get(res.locals.uid, req.params.code)),
  };
}
