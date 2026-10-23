import { packages } from '../domain/premiumPackages.js';

export function root(_req, res) {
  res.json({
    service: 'dontlift-premium-api',
    ok: true,
    endpoints: { health: '/health', packages: '/v1/premium/packages' },
  });
}

export function health(_req, res) {
  res.json({ ok: true });
}

export function listPackages(_req, res) {
  res.json({ version: 1, packages });
}

export function checkoutReturn(_req, res) {
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>DontLift</title><main style="font:18px system-ui;max-width:32rem;padding:32px;margin:auto"><h1>Return to DontLift</h1><p>Close this browser and reopen the app to check your payment. Premium is activated after payment verification.</p></main>');
}
