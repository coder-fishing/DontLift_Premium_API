import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createReceiptScanService } from '../src/services/receiptScanService.js';
import { readConfig } from '../src/config/env.js';

const image = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const validScan = {
  status: 'suggested',
  amount: 450000,
  suggested_amount: 450000,
  currency: 'VND',
  needs_confirmation: true,
  evidence: { label: 'TONG CONG', amount_text: '450.000', index: 4, box: [1, 2, 3, 4] },
  warnings: [],
  timings_ms: { preprocess: 2, ocr: 14, extract: 1, total: 17 },
};

function makeRepository({
  premiumExpiresAt = Date.now() + 60_000,
  room = { hostId: 'host-a', status: 'COMPLETED', reconciliationStatus: 'FINALIZED' },
  member = { role: 'HOST', status: 'ACTIVE' },
} = {}) {
  const calls = [];
  return {
    calls,
    async getUser(uid) { calls.push(['user', uid]); return { premiumExpiresAt }; },
    async getRoom(roomId) { calls.push(['room', roomId]); return room; },
    async getMember(roomId, uid) { calls.push(['member', roomId, uid]); return member; },
  };
}

function makeConfig(overrides = {}) {
  return { paddleOcrUrl: 'https://ocr.example.test/scan', paddleOcrApiKey: 'secret-key',
    paddleOcrTimeoutMs: 60_000, ...overrides };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('rejects unsupported and empty image payloads before reading access records or calling PaddleOCR', async () => {
  const repository = makeRepository();
  let requests = 0;
  const service = createReceiptScanService(repository, makeConfig(), async () => { requests++; throw new Error('must not call'); });

  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/gif' }),
    { code: 'invalid-image' });
  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: Buffer.alloc(0), contentType: 'image/jpeg' }),
    { code: 'invalid-image' });
  assert.deepEqual(repository.calls, []);
  assert.equal(requests, 0);
});

test('rejects images over 10 MB before reading access records or calling PaddleOCR', async () => {
  const repository = makeRepository();
  let requests = 0;
  const service = createReceiptScanService(repository, makeConfig(), async () => { requests++; });
  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/jpeg' }),
    { code: 'image-too-large', status: 413 });
  assert.deepEqual(repository.calls, []);
  assert.equal(requests, 0);
});

test('rejects expired Premium entitlement before contacting PaddleOCR', async () => {
  const repository = makeRepository({ premiumExpiresAt: Date.now() - 1 });
  let requests = 0;
  const service = createReceiptScanService(repository, makeConfig(), async () => { requests++; });

  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' }),
    { code: 'premium-required', status: 403 });
  assert.equal(requests, 0);
});

test('rejects non-Host, inactive membership, and unfinalized room before contacting PaddleOCR', async t => {
  const cases = [
    ['another room Host', { room: { hostId: 'someone-else', status: 'COMPLETED', reconciliationStatus: 'FINALIZED' } }],
    ['inactive Host membership', { member: { role: 'HOST', status: 'LEFT' } }],
    ['non-Host membership', { member: { role: 'MEMBER', status: 'ACTIVE' } }],
    ['unfinished room', { room: { hostId: 'host-a', status: 'ACTIVE', reconciliationStatus: 'PENDING' } }],
  ];
  for (const [name, options] of cases) await t.test(name, async () => {
    const repository = makeRepository(options);
    let requests = 0;
    const service = createReceiptScanService(repository, makeConfig(), async () => { requests++; });
    await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' }));
    assert.equal(requests, 0);
  });
});

test('forwards an authorized image as multipart and returns the PaddleOCR scan result', async () => {
  const repository = makeRepository();
  const requests = [];
  const service = createReceiptScanService(repository, makeConfig(), async (url, options) => {
    requests.push({ url, options });
    return jsonResponse(validScan);
  });

  const result = await service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' });
  assert.deepEqual(result, validScan);
  assert.equal(repository.calls[0][0], 'user');
  assert.ok(repository.calls.some(call => call[0] === 'room' && call[1] === 'room-a'));
  assert.ok(repository.calls.some(call => call[0] === 'member' && call[1] === 'room-a' && call[2] === 'host-a'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://ocr.example.test/scan');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-API-Key'], 'secret-key');
  assert.ok(requests[0].options.body instanceof FormData);
  const upload = requests[0].options.body.get('image');
  assert.equal(upload.type, 'image/jpeg');
  assert.deepEqual(Buffer.from(await upload.arrayBuffer()), image);
});

test('returns unavailable when scan service configuration is absent and rejects partial configuration', () => {
  const base = { PUBLIC_BASE_URL: 'https://premium.example.test', FIREBASE_PROJECT_ID: 'test-project',
    PAYOS_CLIENT_ID: 'id', PAYOS_API_KEY: 'key', PAYOS_CHECKSUM_KEY: 'checksum' };
  const config = readConfig(base);
  assert.equal(config.paddleOcrUrl, null);
  assert.equal(config.paddleOcrApiKey, null);
  assert.throws(() => readConfig({ ...base, PADDLEOCR_SCAN_URL: 'https://ocr.example.test/scan' }),
    /PADDLEOCR/);
  assert.throws(() => readConfig({ ...base, PADDLEOCR_API_KEY: 'secret' }),
    /PADDLEOCR/);
});

test('checks Premium before revealing that the PaddleOCR integration is unconfigured', async () => {
  const service = createReceiptScanService(makeRepository({ premiumExpiresAt: Date.now() - 1 }),
    { paddleOcrUrl: null, paddleOcrApiKey: null }, async () => { throw new Error('must not call'); });
  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' }),
    { code: 'premium-required', status: 403 });
});

test('maps PaddleOCR busy and server errors to a sanitized unavailable error', async t => {
  for (const status of [401, 503, 500]) await t.test(String(status), async () => {
    const service = createReceiptScanService(makeRepository(), makeConfig(), async () => jsonResponse({}, status));
    await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' }),
      { code: 'ocr-unavailable', status: 503 });
  });
});

test('maps the configured PaddleOCR deadline to a sanitized timeout error without retrying', async () => {
  let requests = 0;
  const service = createReceiptScanService(makeRepository(), makeConfig(), async (_url, options) => {
    requests++;
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    const timeout = new Error('provider timed out');
    timeout.name = 'TimeoutError';
    throw timeout;
  });
  await assert.rejects(service.scan({ uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' }),
    { code: 'ocr-timeout', status: 504 });
  assert.equal(requests, 1);
});

test('Premium API scan route authenticates and returns a versioned result', async t => {
  const result = { ...validScan };
  let command;
  const base = await startServer(t, {
    verifyToken: async token => token === 'valid' ? { uid: 'host-a' } : null,
    orders: {}, webhook: async () => undefined, avatars: { upload: async () => ({}), remove: async () => ({}) },
    receiptScans: { scan: async value => { command = value; return result; } },
  });

  const rejected = await fetch(base + '/v1/bills/scan?roomId=room-a', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image,
  });
  assert.equal(rejected.status, 401);
  assert.equal(command, undefined);

  const response = await fetch(base + '/v1/bills/scan?roomId=room-a', {
    method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'image/jpeg' }, body: image,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(command, { uid: 'host-a', roomId: 'room-a', buffer: image, contentType: 'image/jpeg' });
  assert.deepEqual(await response.json(), { version: 1, ...result });
});

test('scan route reports oversized raw uploads with a specific 413 code', async t => {
  const base = await startServer(t, {
    verifyToken: async () => ({ uid: 'host-a' }), orders: {}, webhook: async () => undefined,
    avatars: { upload: async () => ({}), remove: async () => ({}) },
    receiptScans: { scan: async () => { throw new Error('oversized image must not reach service'); } },
  });
  const response = await fetch(base + '/v1/bills/scan?roomId=room-a', {
    method: 'POST', headers: { Authorization: 'Bearer valid', 'Content-Type': 'image/jpeg' },
    body: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { version: 1, code: 'image-too-large' });
});

async function startServer(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

