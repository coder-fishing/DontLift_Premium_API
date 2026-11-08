export function createAvatarController(avatars) {
  return {
    upload: async (req, res) => {
      const avatar = await avatars.upload({ uid: res.locals.uid, buffer: req.body, contentType: req.get('content-type')?.split(';')[0].trim().toLowerCase() });
      res.status(200).json({ version: 1, ...avatar });
    },
    remove: async (_req, res) => {
      const result = await avatars.remove({ uid: res.locals.uid });
      res.status(200).json({ version: 1, ...result });
    },
  };
}
