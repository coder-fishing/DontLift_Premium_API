import { PayOS } from '@payos/node';

export function createPayOS(config) {
  const sdk = new PayOS({ clientId: config.clientId, apiKey: config.apiKey, checksumKey: config.checksumKey,
    timeout: 15000, maxRetries: 0 });
  return { create: data => sdk.paymentRequests.create(data), get: code => sdk.paymentRequests.get(code),
    verify: payload => sdk.webhooks.verify(payload) };
}
