import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { memoryDb, testimonialChain } from './helpers';

describe('production / mainnet mode', () => {
  test('local demo endpoints are not registered when localDemo is false', async () => {
    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false, adminToken: 'secret' });
    expect((await app.request('/api/local/wallet')).status).toBe(404);
    expect((await app.request('/api/fixtures')).status).toBe(404);
    const rpc = await app.request('/api/local/rpc', { method: 'POST', body: '{}' });
    expect(rpc.status).toBe(404);
  });

  test('local demo is hard-disabled in production even when the flag is set', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const db = memoryDb();
      const app = createApp({ db, chain: testimonialChain(), localDemo: true, adminToken: 'secret' });
      expect((await app.request('/api/local/wallet')).status).toBe(404);
      expect((await app.request('/api/index/reconcile', { method: 'POST' })).status).toBe(401);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('readiness fails closed when the chain is not configured', async () => {
    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false, adminToken: 'secret' });
    const res = await app.request('/api/ready');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: { configured: boolean } };
    expect(body.ready).toBe(false);
    expect(body.checks.configured).toBe(false);
  });

  test('public maintenance mutations require the admin token', async () => {
    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false, adminToken: 'secret' });
    expect((await app.request('/api/index/reconcile', { method: 'POST' })).status).toBe(401);
    expect(
      (await app.request('/api/index/reconcile', { method: 'POST', headers: { 'x-sprout-admin-token': 'wrong' } })).status,
    ).toBe(401);
    expect((await app.request('/api/jobs/run', { method: 'POST' })).status).toBe(401);
  });

  test('same-origin SPA fallback serves the built index for client routes', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'sprout-dist-'));
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>sprout</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("ok")');

    const db = memoryDb();
    const app = createApp({ db, chain: testimonialChain(), localDemo: false, adminToken: 'secret', serveWeb: true, webDistPath: dist });

    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('console.log');

    const gift = await app.request(`/gift/0x${'ab'.repeat(32)}`);
    expect(gift.status).toBe(200);
    expect(await gift.text()).toContain('sprout');

    const apiMissing = await app.request('/api/does-not-exist');
    expect(apiMissing.status).toBe(404);
  });
});
