import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const require = createRequire(import.meta.url),
  https = require('node:https');
const { CredentialRefresh } = require('../electron/credentials.cjs');
const { validateConnection } = require('../electron/connection.cjs');
afterEach(() => vi.restoreAllMocks());
describe('temporary credential refresh', () => {
  it('uses HTTPS and a dedicated Bearer token, deduplicates requests, and invalidates after token changes', async () => {
    let calls = 0;
    const headers: any[] = [];
    vi.spyOn(https, 'get').mockImplementation((_url: any, options: any, callback: any) => {
      calls++;
      headers.push(options.headers);
      const request = new EventEmitter() as any;
      request.destroy = (error: Error) => request.emit('error', error);
      queueMicrotask(() =>
        callback(
          Object.assign(
            Readable.from([
              JSON.stringify({
                Credentials: {
                  AccessKeyId: 'refreshed-id',
                  AccessKeySecret: 'refreshed-secret',
                  SecurityToken: 'refreshed-token',
                  Expiration: new Date(Date.now() + 3600000).toISOString(),
                },
              }),
            ]),
            { statusCode: 200 },
          ),
        ),
      );
      return request;
    });
    let connection = {
      id: 'conn',
      provider: 's3',
      credentialRefreshUrl: 'https://auth.example.com/credentials',
      credentialRefreshToken: 'bearer-a',
      accessKeyId: 'original-id',
      accessKeySecret: 'never-send-this',
    };
    const manager = new CredentialRefresh({ get: async () => connection });
    const [first, second] = await Promise.all([manager.get('conn'), manager.get('conn')]);
    expect(first.stsToken).toBe('refreshed-token');
    expect(second.accessKeyId).toBe('refreshed-id');
    expect(calls).toBe(1);
    await manager.get('conn');
    expect(calls).toBe(1);
    expect(headers).toEqual([{ Authorization: 'Bearer bearer-a' }]);
    expect(JSON.stringify(headers)).not.toContain('never-send-this');
    connection = { ...connection, credentialRefreshToken: 'bearer-b' };
    await manager.get('conn');
    expect(calls).toBe(2);
    expect(headers[1]).toEqual({ Authorization: 'Bearer bearer-b' });
  });
  it('rejects insecure refresh URLs and does not allow credentials in URL query parameters', () => {
    const input = {
      name: 'refresh',
      provider: 's3',
      endpoint: 'https://s3.example.com',
      credentialRefreshUrl: 'http://auth.example.com/credentials',
    };
    expect(() => validateConnection(input)).toThrow('HTTPS');
    expect(() =>
      validateConnection({
        ...input,
        credentialRefreshUrl: 'https://auth.example.com/credentials?token=secret',
      }),
    ).toThrow('HTTPS');
    expect(
      validateConnection({ ...input, credentialRefreshUrl: 'https://auth.example.com/credentials' })
        .accessKeySecret,
    ).toBe('');
  });
});
