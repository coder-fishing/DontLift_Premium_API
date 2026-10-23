import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPayOS } from '../src/providers/payosClient.js';
import { createWebhookService } from '../src/services/webhookService.js';
import { createOrderService } from '../src/services/orderService.js';

const checksumKey = 'unit-test-only-checksum';

test('switching packages confirms provider cancellation and preserves paid orders', async () => {
  const order = { uid: 'owner', orderCode: 42, amountVnd: 89000, status: 'PENDING', paymentLinkId: 'link-42' };
  let status = 'PENDING';
  let cancellations = 0;
  const link = () => ({ orderCode: 42, id: 'link-42', amount: 89000, amountPaid: 89000, status });
  const store = {
    current: async () => order,
    markProviderTerminal: async (_code, _id, terminal) => ({ ...order, status: terminal }),
    grant: async () => ({ ...order, status: 'PAID' }),
  };
  const api = createOrderService(store, {
    get: async () => link(),
    cancel: async () => { cancellations++; status = 'CANCELLED'; return link(); },
  }, 'https://example.invalid');
  assert.equal((await api.cancelCurrent('owner', { version: 1 })).status, 'CANCELLED');
  status = 'PAID';
  assert.equal((await api.cancelCurrent('owner', { version: 1 })).status, 'PAID');
  assert.equal(cancellations, 1);
  await assert.rejects(api.cancelCurrent('owner', { version: 2 }), /invalid-argument/);
});
const sdk = createPayOS({ clientId: 'unit-test-client', apiKey: 'unit-test-api', checksumKey });
function payload(overrides = {}) {
  const data = { orderCode: 42, amount: 89000, currency: 'VND', code: '00', paymentLinkId: 'link-42', reference: 'test-reference', ...overrides };
  const query = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&');
  return { code: '00', success: true, data, signature: createHmac('sha256', checksumKey).update(query).digest('hex') };
}
test('real SDK signature verification rejects forged payload and validates payment linkage', async () => {
  let grants = 0;
  const order = { orderCode: 42, amountVnd: 89000, paymentLinkId: 'link-42' };
  const provider = { ...sdk, get: async () => ({ orderCode: 42, id: 'link-42', status: 'PAID', amount: 89000, amountPaid: 89000 }) };
  const webhook = createWebhookService({ get: async () => order, grant: async () => { grants++; } }, provider);
  await assert.rejects(webhook({ ...payload(), signature: 'forged' }), /invalid-signature/);
  await assert.rejects(webhook(payload({ amount: 1 })), /payment-mismatch/);
  await assert.rejects(webhook(payload({ paymentLinkId: 'other' })), /payment-mismatch/);
  assert.equal(grants, 0);
  await webhook(payload());
  assert.equal(grants, 1);
  await createWebhookService({ get: async () => null }, provider)(payload());
  assert.equal(grants, 1);
});
test('provider failure never grants; store commit failure remains retryable', async () => {
  const store = { get: async () => ({ amountVnd: 89000 }), grant: async () => { throw new Error('db-unavailable'); } };
  await assert.rejects(createWebhookService(store, { ...sdk, get: async () => { throw new Error(); } })(payload()), /unavailable/);
  await assert.rejects(createWebhookService(store, { ...sdk, get: async () => ({ orderCode: 42, id: 'link-42', status: 'PAID', amount: 89000, amountPaid: 89000 }) })(payload()), /db-unavailable/);
});
test('order command rejects client price, reuses reserved order after ambiguous create and enforces ownership', async () => {
  const row = { uid: 'owner', orderCode: 42, requestId: '00000000-0000-4000-8000-000000000001', packageId: 'MONTH_1', amountVnd: 89000, status: 'CREATING' };
  let creates = 0;
  const store = { reserve: async () => ({ order: row, owned: true }), get: async () => row,
    saveLink: async (_code, link) => ({ ...row, ...link, status: 'PENDING' }), releaseLease: async () => {} };
  const api = createOrderService(store, { get: async () => ({ orderCode: 42, id: 'link-42', amount: 89000, qrCode: 'test-qr' }), create: async () => { creates++; } }, 'https://example.invalid');
  const command = { version: 1, requestId: row.requestId, packageId: 'MONTH_1' };
  await assert.rejects(api.create('owner', { ...command, amount: 1 }), /invalid-argument/);
  assert.equal((await api.create('owner', command)).orderCode, 42);
  assert.equal(creates, 0);
  await assert.rejects(api.get('outsider', 42), /not-found/);
});

test('lost create response is recovered with the same order, without a second payment link', async () => {
  let creates = 0;
  let calls = 0;
  const row = { uid: 'owner', orderCode: 42, packageId: 'MONTH_1', amountVnd: 89000, grantedMonths: 1, status: 'CREATING' };
  const store = { reserve: async () => ({ order: row, owned: true, fresh: calls++ === 0 }), releaseLease: async () => {},
    saveLink: async (_code, link) => ({ ...row, ...link, status: 'PENDING' }) };
  const api = createOrderService(store, {
    get: async () => ({ orderCode: 42, id: 'link-42', amount: 89000, qrCode: 'test-qr' }),
    create: async data => { creates++; assert.equal(data.amount, 89000); assert.equal(data.description.length, 9); throw new Error('response-lost'); },
  }, 'https://example.invalid');
  const command = { version: 1, requestId: '00000000-0000-4000-8000-000000000001', packageId: 'MONTH_1' };
  await assert.rejects(api.create('owner', command), /unavailable/);
  assert.equal((await api.create('owner', command)).orderCode, 42);
  assert.equal(creates, 1);
});
