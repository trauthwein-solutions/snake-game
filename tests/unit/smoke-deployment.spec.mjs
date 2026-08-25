/* global ReadableStream, Response, URL */

import { describe, expect, it, vi } from 'vitest';

import { smokeDeployment } from '../../scripts/smoke-deployment.mjs';

const headers = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
};

const html = (assets = '<script src="/assets/app.js"></script>') =>
  `<!doctype html><title>SNAKISH</title>${assets}`;

const response = (body, init = {}) =>
  new Response(body, {
    status: 200,
    headers,
    ...init,
  });

const assetResponse = (body, contentType, init = {}) =>
  response(body, {
    ...init,
    headers: { 'content-type': contentType, ...(init.headers ?? {}) },
  });

const router = (routes) =>
  vi.fn(async (input) => {
    const url = String(input);
    const value = routes.get(url);
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value();
    if (!value) throw new Error(`Unexpected fetch: ${url}`);
    return value;
  });

describe('deployment smoke test', () => {
  it('accepts relative and root-local assets, resolving from a project URL', async () => {
    const fetchImpl = router(
      new Map([
        [
          'https://example.test/project/',
          response(
            html(
              '<script src="assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
            ),
          ),
        ],
        [
          'https://example.test/project/assets/app.js',
          assetResponse('js', 'text/javascript'),
        ],
        [
          'https://example.test/assets/app.css',
          assetResponse('css', 'text/css'),
        ],
      ]),
    );

    await expect(
      smokeDeployment('https://example.test/project/', { fetchImpl }),
    ).resolves.toMatchObject({ assetCount: 2 });
  });

  it('deduplicates repeated asset URLs', async () => {
    const fetchImpl = router(
      new Map([
        [
          'https://example.test/',
          response(
            html(
              '<script src="/app.js"></script><script src="/app.js"></script>',
            ),
          ),
        ],
        ['https://example.test/app.js', assetResponse('js', 'text/javascript')],
      ]),
    );

    await smokeDeployment('https://example.test/', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects non-HTTPS input before fetching', async () => {
    const fetchImpl = vi.fn();
    await expect(
      smokeDeployment('http://example.test/', { fetchImpl }),
    ).rejects.toThrow(/https/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires the SNAKISH marker and a successful HTML response', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([['https://example.test/', response('wrong marker')]]),
        ),
      }),
    ).rejects.toThrow(/SNAKISH/);

    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            ['https://example.test/', response('SNAKISH', { status: 503 })],
          ]),
        ),
      }),
    ).rejects.toThrow(/503/);
  });

  it('follows bounded same-origin redirects', async () => {
    const fetchImpl = router(
      new Map([
        [
          'https://example.test/',
          response('', { status: 302, headers: { location: '/game/' } }),
        ],
        [
          'https://example.test/game/',
          response(html('<script src="app.js"></script>')),
        ],
        [
          'https://example.test/game/app.js',
          assetResponse('js', 'application/javascript'),
        ],
      ]),
    );

    await expect(
      smokeDeployment('https://example.test/', { fetchImpl }),
    ).resolves.toMatchObject({ finalUrl: 'https://example.test/game/' });
  });

  it('rejects cross-origin and excessive redirects', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            [
              'https://example.test/',
              response('', {
                status: 302,
                headers: { location: 'https://other.test/' },
              }),
            ],
          ]),
        ),
      }),
    ).rejects.toThrow(/origin/i);

    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      const count = Number(url.searchParams.get('n') ?? '0');
      return response('', {
        status: 302,
        headers: { location: `/?n=${count + 1}` },
      });
    });
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/redirect/i);
  });

  it('rejects cross-origin script and stylesheet URLs', async () => {
    for (const asset of [
      '<script src="https://cdn.test/app.js"></script>',
      '<link rel="stylesheet" href="//cdn.test/app.css">',
    ]) {
      await expect(
        smokeDeployment('https://example.test/', {
          fetchImpl: router(
            new Map([['https://example.test/', response(html(asset))]]),
          ),
        }),
      ).rejects.toThrow(/cross-origin/i);
    }
  });

  it.each([
    [
      'non-2xx',
      assetResponse('bad', 'text/javascript', { status: 404 }),
      /404/,
    ],
    ['empty', assetResponse('', 'text/javascript'), /empty/i],
  ])('rejects a %s asset', async (_name, assetResponse, expected) => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            ['https://example.test/', response(html())],
            ['https://example.test/assets/app.js', assetResponse],
          ]),
        ),
      }),
    ).rejects.toThrow(expected);
  });

  it.each([
    ['text/javascript', 'text/javascript'],
    ['application/javascript', 'Application/JavaScript; Charset=UTF-8'],
  ])('accepts the explicit JavaScript media type %s', async (_name, type) => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            ['https://example.test/', response(html())],
            ['https://example.test/assets/app.js', assetResponse('js', type)],
          ]),
        ),
      }),
    ).resolves.toMatchObject({ assetCount: 1 });
  });

  it('normalizes stylesheet media type case and parameters', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            [
              'https://example.test/',
              response(html('<link rel="stylesheet" href="/assets/app.css">')),
            ],
            [
              'https://example.test/assets/app.css',
              assetResponse('css', 'TEXT/CSS; charset="utf-8"'),
            ],
          ]),
        ),
      }),
    ).resolves.toMatchObject({ assetCount: 1 });
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['HTML', 'text/html'],
    ['CSS', 'text/css'],
    ['malformed', 'text/javascript; charset'],
  ])('rejects a script with %s content-type', async (_name, contentType) => {
    const assetHeaders =
      contentType === undefined ? {} : { 'content-type': contentType };
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            ['https://example.test/', response(html())],
            [
              'https://example.test/assets/app.js',
              response('js', { headers: assetHeaders }),
            ],
          ]),
        ),
      }),
    ).rejects.toThrow(/javascript MIME/i);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['HTML', 'text/html'],
    ['JavaScript', 'application/javascript'],
    ['malformed', 'text/css, text/html'],
  ])(
    'rejects a stylesheet with %s content-type',
    async (_name, contentType) => {
      const assetHeaders =
        contentType === undefined ? {} : { 'content-type': contentType };
      await expect(
        smokeDeployment('https://example.test/', {
          fetchImpl: router(
            new Map([
              [
                'https://example.test/',
                response(
                  html('<link rel="stylesheet" href="/assets/app.css">'),
                ),
              ],
              [
                'https://example.test/assets/app.css',
                response('css', { headers: assetHeaders }),
              ],
            ]),
          ),
        }),
      ).rejects.toThrow(/stylesheet MIME/i);
    },
  );

  it.each([
    [
      'hashed script',
      '<script src="/assets/app-deadbeef.js"></script>',
      'https://example.test/assets/app-deadbeef.js',
      /javascript MIME/i,
    ],
    [
      'hashed stylesheet',
      '<link rel="stylesheet" href="/assets/app-deadbeef.css">',
      'https://example.test/assets/app-deadbeef.css',
      /stylesheet MIME/i,
    ],
  ])(
    'rejects a missing %s served as the HTML SPA fallback specifically on MIME',
    async (_name, markup, assetUrl, expected) => {
      const fallback = html(markup);
      await expect(
        smokeDeployment('https://example.test/', {
          fetchImpl: router(
            new Map([
              ['https://example.test/', response(fallback)],
              [
                assetUrl,
                response(fallback, {
                  headers: { 'content-type': 'text/html' },
                }),
              ],
            ]),
          ),
        }),
      ).rejects.toThrow(expected);
    },
  );

  it('requires every configured security header', async () => {
    for (const missing of Object.keys(headers)) {
      const incomplete = { ...headers };
      delete incomplete[missing];
      await expect(
        smokeDeployment('https://example.test/', {
          fetchImpl: router(
            new Map([
              [
                'https://example.test/',
                response(html(), { headers: incomplete }),
              ],
            ]),
          ),
        }),
      ).rejects.toThrow(new RegExp(missing, 'i'));
    }
  });

  it('requires the nosniff header value', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            [
              'https://example.test/',
              response(html(), {
                headers: {
                  ...headers,
                  'x-content-type-options': 'invalid',
                },
              }),
            ],
          ]),
        ),
      }),
    ).rejects.toThrow(/nosniff/i);
  });

  it('bounds response body size', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([['https://example.test/', response('SNAKISH too large')]]),
        ),
        maxBodyBytes: 8,
      }),
    ).rejects.toThrow(/size/i);
  });

  it('times out even when an injected fetch ignores abort signals', async () => {
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: vi.fn(() => new Promise(() => {})),
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('times out while reading a stalled response body', async () => {
    const stalledBody = new ReadableStream({ start() {} });
    await expect(
      smokeDeployment('https://example.test/', {
        fetchImpl: router(
          new Map([
            ['https://example.test/', response(stalledBody, { headers })],
          ]),
        ),
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
