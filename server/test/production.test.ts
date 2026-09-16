import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { insertGift } from '../src/repo';
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

describe('gift link previews', () => {
  const realIndex = readFileSync(join(import.meta.dir, '..', '..', 'web', 'index.html'), 'utf8');

  function giftApp(label: string | null) {
    const dist = mkdtempSync(join(tmpdir(), 'sprout-dist-'));
    writeFileSync(join(dist, 'index.html'), realIndex);
    const db = memoryDb();
    const id = `0x${'cd'.repeat(32)}`;
    insertGift(db, { id, vaultId: '0x00000000000000000000000000000000000000a1', label, acceptedAssets: [], status: 'active' });
    const app = createApp({
      db,
      chain: testimonialChain(),
      localDemo: false,
      adminToken: 'secret',
      serveWeb: true,
      webDistPath: dist,
      publicOrigin: 'https://sprout.example',
    });
    return { app, id };
  }

  const meta = (html: string, key: string) =>
    html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

  test('a known gift link previews as a gift, with its label', async () => {
    const { app, id } = giftApp('Birthday 2026');
    const html = await (await app.request(`/gift/${id}`)).text();
    expect(meta(html, 'og:title')).toBe('Birthday 2026 · Help a sprout grow');
    expect(meta(html, 'twitter:title')).toBe('Birthday 2026 · Help a sprout grow');
    expect(meta(html, 'og:image')).toBe('https://sprout.example/og-gift.jpg');
    expect(meta(html, 'twitter:image')).toBe('https://sprout.example/og-gift.jpg');
    expect(meta(html, 'og:url')).toBe(`https://sprout.example/gift/${id}`);
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(html).toContain('<title>Birthday 2026 · Help a sprout grow</title>');
    // The app itself still loads.
    expect(html).toContain('<div id="root"></div>');
  });

  test('a label cannot break out of the tag', async () => {
    const { app, id } = giftApp('"><script>alert(1)</script>');
    const html = await (await app.request(`/gift/${id}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(meta(html, 'og:title')).toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Help a sprout grow');
  });

  test('unknown gifts and other routes keep the site-wide preview', async () => {
    const { app } = giftApp(null);
    const unknown = await (await app.request(`/gift/0x${'ef'.repeat(32)}`)).text();
    expect(meta(unknown, 'og:image')).toBe('https://www.sproutfy.tech/og-card.jpg');
    const home = await (await app.request('/dashboard')).text();
    expect(meta(home, 'og:title')).toBe('Sprout: grow a portfolio for your kid');
  });

  test('an unlabeled gift gets the generic invitation', async () => {
    const { app, id } = giftApp(null);
    const html = await (await app.request(`/gift/${id}`)).text();
    expect(meta(html, 'og:title')).toBe('You’re invited to help a sprout grow');
  });
});
