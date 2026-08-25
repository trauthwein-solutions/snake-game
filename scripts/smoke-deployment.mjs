/* global AbortController, Buffer, URL, clearTimeout, console, process, setTimeout */

import { pathToFileURL } from 'node:url';

const REQUIRED_HEADERS = [
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

// These are the two explicit JavaScript media types used by current static
// servers (including Caddy) and accepted interoperably by modern browsers.
// Legacy JavaScript aliases are intentionally not accepted.
const JAVASCRIPT_MEDIA_TYPES = new Set([
  'text/javascript',
  'application/javascript',
]);
const contentTypePattern =
  /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)(?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*=\s*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\t\x20-\x7e])*"))*\s*$/;

const normalizedMediaType = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = contentTypePattern.exec(value);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
};

const withTimeout = async (operation, timeoutMs, label, controller) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const readBoundedBody = async (response, maxBodyBytes, label) => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new Error(`${label} exceeds the ${maxBodyBytes}-byte size limit`);
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the ${maxBodyBytes}-byte size limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength);
};

const fetchSameOrigin = async (
  initialUrl,
  { fetchImpl, timeoutMs, maxRedirects, maxBodyBytes, expectedOrigin, label },
) => {
  let currentUrl = initialUrl;

  for (let redirects = 0; ; redirects += 1) {
    const controller = new AbortController();
    let response;
    try {
      response = await withTimeout(
        Promise.resolve(
          fetchImpl(currentUrl.href, {
            redirect: 'manual',
            signal: controller.signal,
          }),
        ),
        timeoutMs,
        label,
        controller,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${label} timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw error;
    }

    if (!redirectStatuses.has(response.status)) {
      if (currentUrl.origin !== expectedOrigin) {
        throw new Error(
          `${label} final origin differs from the requested origin`,
        );
      }
      let body;
      try {
        body = await withTimeout(
          readBoundedBody(response, maxBodyBytes, label),
          timeoutMs,
          label,
          controller,
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`${label} timed out after ${timeoutMs}ms`, {
            cause: error,
          });
        }
        throw error;
      }
      return { response, body, finalUrl: currentUrl };
    }

    if (redirects >= maxRedirects) {
      throw new Error(`${label} exceeded the ${maxRedirects}-redirect limit`);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error(`${label} redirect has no Location header`);
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== expectedOrigin) {
      throw new Error(`${label} redirect left the requested origin`);
    }
    controller.abort();
    currentUrl = nextUrl;
  }
};

const attributeValue = (tag, name) => {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
};

const assetReferences = (html) => {
  const references = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const source = attributeValue(match[0], 'src');
    if (source) references.push({ kind: 'script', value: source });
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const relation = attributeValue(match[0], 'rel');
    const href = attributeValue(match[0], 'href');
    if (href && relation?.toLowerCase().split(/\s+/).includes('stylesheet')) {
      references.push({ kind: 'stylesheet', value: href });
    }
  }
  return references;
};

export const smokeDeployment = async (
  requestedUrl,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 8_000,
    maxRedirects = 3,
    maxBodyBytes = 1_048_576,
  } = {},
) => {
  const startUrl = new URL(requestedUrl);
  if (startUrl.protocol !== 'https:') {
    throw new Error('Smoke URL must use https:');
  }
  if (startUrl.username || startUrl.password) {
    throw new Error('Smoke URL must not contain credentials');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive integer');
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('maxRedirects must be a non-negative integer');
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error('maxBodyBytes must be a positive integer');
  }

  const page = await fetchSameOrigin(startUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    maxBodyBytes,
    expectedOrigin: startUrl.origin,
    label: 'HTML response',
  });
  if (page.response.status < 200 || page.response.status >= 300) {
    throw new Error(`HTML response returned HTTP ${page.response.status}`);
  }
  for (const header of REQUIRED_HEADERS) {
    if (!page.response.headers.get(header)?.trim()) {
      throw new Error(`HTML response is missing ${header}`);
    }
  }
  if (
    page.response.headers.get('x-content-type-options')?.toLowerCase() !==
    'nosniff'
  ) {
    throw new Error('HTML response x-content-type-options must be nosniff');
  }

  const pageHtml = page.body.toString('utf8');
  if (!pageHtml.includes('SNAKISH')) {
    throw new Error('HTML response does not contain SNAKISH');
  }

  const assets = new Map();
  for (const reference of assetReferences(pageHtml)) {
    const assetUrl = new URL(reference.value, page.finalUrl);
    if (assetUrl.username || assetUrl.password) {
      throw new Error(`${reference.kind} URL must not contain credentials`);
    }
    if (assetUrl.origin !== startUrl.origin) {
      throw new Error(`Unexpected cross-origin ${reference.kind} URL`);
    }
    const expectedSuffix = reference.kind === 'script' ? '.js' : '.css';
    if (!assetUrl.pathname.toLowerCase().endsWith(expectedSuffix)) {
      throw new Error(`${reference.kind} URL is not a ${expectedSuffix} asset`);
    }
    assetUrl.hash = '';
    const existing = assets.get(assetUrl.href);
    if (existing) existing.kinds.add(reference.kind);
    else {
      assets.set(assetUrl.href, {
        url: assetUrl,
        kinds: new Set([reference.kind]),
      });
    }
  }
  if (assets.size === 0)
    throw new Error('HTML response contains no local JS/CSS assets');

  for (const { url: assetUrl, kinds } of assets.values()) {
    const asset = await fetchSameOrigin(assetUrl, {
      fetchImpl,
      timeoutMs,
      maxRedirects,
      maxBodyBytes,
      expectedOrigin: startUrl.origin,
      label: `Asset ${assetUrl.href}`,
    });
    if (asset.response.status < 200 || asset.response.status >= 300) {
      throw new Error(
        `Asset ${assetUrl.href} returned HTTP ${asset.response.status}`,
      );
    }
    if (asset.body.byteLength === 0) {
      throw new Error(`Asset ${assetUrl.href} returned an empty body`);
    }
    const mediaType = normalizedMediaType(
      asset.response.headers.get('content-type'),
    );
    if (kinds.has('script') && !JAVASCRIPT_MEDIA_TYPES.has(mediaType)) {
      throw new Error(
        `Asset ${assetUrl.href} does not have an accepted JavaScript MIME type`,
      );
    }
    if (kinds.has('stylesheet') && mediaType !== 'text/css') {
      throw new Error(
        `Asset ${assetUrl.href} does not have the required stylesheet MIME type`,
      );
    }
  }

  return { finalUrl: page.finalUrl.href, assetCount: assets.size };
};

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const url = process.argv[2];
  if (!url || process.argv.length !== 3) {
    console.error('Usage: node smoke-deployment.mjs <https-url>');
    process.exitCode = 2;
  } else {
    try {
      const result = await smokeDeployment(url);
      console.log(
        `Smoke passed: ${result.finalUrl} (${result.assetCount} local assets)`,
      );
    } catch (error) {
      console.error(
        `Smoke failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    }
  }
}
