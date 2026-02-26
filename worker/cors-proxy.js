/**
 * Article Local Reader CORS Proxy — Cloudflare Worker
 *
 * Deployed automatically via Cloudflare Git integration when worker/ changes.
 * Can also be deployed manually with Wrangler.
 *
 * Endpoints:
 *   GET  /?url=<encoded_article_url>        — Fetch and return article HTML
 *   GET  /?url=<encoded_article_url>&mode=markdown
 *                                           — Fetch markdown via Jina Reader
 *   POST /?action=translate                  — Translate text via Google Translate API
 *        Body: { text: string, from: string, to: string }
 *   GET  /?action=translate&text=...&from=...&to=...
 *                                           — Translate fallback for GET-only clients/proxies
 *   GET  /?action=tts&text=...&lang=en      — Fetch TTS audio via Google Translate TTS
 *
 * Environment bindings (set in wrangler.toml or via `wrangler secret put`):
 *   ALLOWED_ORIGIN  — GitHub Pages origin (e.g. "https://user.github.io")
 *   PROXY_SECRET    — shared secret the client sends via X-Proxy-Key header
 *   JINA_KEY        — optional Jina Reader key used server-side only
 */

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB (HTML articles)
const MAX_PDF_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB (PDF documents)
const MAX_TRANSLATE_CHARS = 5000;
const MAX_TTS_CHARS = 200;
const FETCH_TIMEOUT_MS = 10_000;

// Rate limiting: 60 requests per 60-second sliding window per IP
// (raised from 20 to support TTS prefetching ~20 sentences ahead)
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd/i,
  /^localhost$/i,
  /^::ffff:127\./i,       // IPv4-mapped IPv6 loopback
  /^::ffff:10\./i,        // IPv4-mapped IPv6 private
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:0\./i,
  /^\[::1\]$/,            // bracketed IPv6 in URL hostname
  /^\[::ffff:/i,
];

const MAX_REDIRECTS = 5;

const LANG_CODE_RE = /^[a-z]{2,5}(-[a-zA-Z]{2,5})?$/;

// Each edge location keeps its own counters.
const rateLimitMap = new Map(); // IP -> timestamp[]
let lastCleanup = Date.now();

export default {
  async fetch(request, env) {
    const context = createRequestContext(request, env);

    if (request.method === 'OPTIONS') {
      return noContentResponse(context.allowedOrigin);
    }

    if (!isMethodAllowed(request.method)) {
      return errorResponse(405, 'Only GET and POST requests are allowed.', context.allowedOrigin);
    }

    const authError = validateProxyKey(request, context.proxySecret, context.allowedOrigin);
    if (authError) return authError;

    const rateCheck = applyRateLimit(request);
    if (!rateCheck.allowed) {
      return errorResponse(
        429,
        `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} requests per minute. Try again in ${rateCheck.retryAfter} seconds.`,
        context.allowedOrigin,
        {
          'Retry-After': String(rateCheck.retryAfter),
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      );
    }

    context.rateCheck = rateCheck;

    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get('action');
    if (action === 'translate') {
      return routeTranslate(request, requestUrl, context);
    }
    if (action === 'tts') {
      return routeTts(requestUrl, context);
    }

    if (request.method !== 'GET') {
      return errorResponse(405, 'Only GET requests are allowed.', context.allowedOrigin);
    }

    return routeArticleFetch(requestUrl, context);
  },
};

function createRequestContext(request, env) {
  return {
    request,
    allowedOrigin: env.ALLOWED_ORIGIN || null,
    proxySecret: env.PROXY_SECRET || '',
    jinaKey: env.JINA_KEY || '',
    rateCheck: null,
  };
}

function isMethodAllowed(method) {
  return method === 'GET' || method === 'POST';
}

function validateProxyKey(request, proxySecret, allowedOrigin) {
  if (!proxySecret) return null;
  const clientKey = request.headers.get('X-Proxy-Key') || '';
  if (clientKey === proxySecret) return null;
  return errorResponse(403, 'Invalid or missing proxy key.', allowedOrigin);
}

function applyRateLimit(request) {
  cleanupStaleEntries();
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  return checkRateLimit(clientIp);
}

async function routeTranslate(request, requestUrl, context) {
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body.', context.allowedOrigin);
    }
    return translateText(body?.text, body?.from, body?.to, context);
  }

  if (request.method === 'GET') {
    return translateText(
      requestUrl.searchParams.get('text'),
      requestUrl.searchParams.get('from') || 'auto',
      requestUrl.searchParams.get('to') || 'en',
      context,
    );
  }

  return errorResponse(405, 'Translate endpoint supports GET or POST only.', context.allowedOrigin);
}

async function routeTts(requestUrl, context) {
  const text = requestUrl.searchParams.get('text');
  const lang = requestUrl.searchParams.get('lang') || 'en';

  if (!text || typeof text !== 'string') {
    return errorResponse(400, 'Missing "text" parameter.', context.allowedOrigin);
  }
  if (text.length > MAX_TTS_CHARS) {
    return errorResponse(400, `Text too long (${text.length} chars, max ${MAX_TTS_CHARS}).`, context.allowedOrigin);
  }
  if (!LANG_CODE_RE.test(lang)) {
    return errorResponse(400, `Invalid language code: "${lang}".`, context.allowedOrigin);
  }

  const ttsUrl =
    `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8` +
    `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;

  let resp;
  try {
    resp = await fetchWithTimeout(ttsUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'TTS request timed out.', context.allowedOrigin);
    }
    return errorResponse(502, `TTS fetch failed: ${getErrorMessage(err)}`, context.allowedOrigin);
  }

  if (!resp.ok) {
    return errorResponse(502, `TTS API returned ${resp.status}.`, context.allowedOrigin);
  }

  const audioBody = resp.body;
  return new Response(audioBody, {
    status: 200,
    headers: successHeaders(context, {
      'Content-Type': resp.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400',
    }),
  });
}

async function routeArticleFetch(requestUrl, context) {
  const parsedRequest = parseAndValidateArticleRequest(requestUrl, context.allowedOrigin);
  if ('error' in parsedRequest) return parsedRequest.error;

  const { targetUrl, mode } = parsedRequest;
  if (mode === 'markdown') {
    return fetchViaJina(targetUrl, context);
  }
  return fetchArticleHtml(targetUrl, context);
}

function parseAndValidateArticleRequest(requestUrl, allowedOrigin) {
  const targetUrl = requestUrl.searchParams.get('url');
  const mode = requestUrl.searchParams.get('mode') || 'html';

  if (!targetUrl) {
    return { error: errorResponse(400, 'Missing ?url= query parameter.', allowedOrigin) };
  }
  if (mode !== 'html' && mode !== 'markdown') {
    return { error: errorResponse(400, 'Invalid mode. Supported values: html, markdown.', allowedOrigin) };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { error: errorResponse(400, 'Invalid URL.', allowedOrigin) };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: errorResponse(400, 'Only http and https URLs are allowed.', allowedOrigin) };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { error: errorResponse(403, 'Access to internal addresses is not allowed.', allowedOrigin) };
  }

  return { targetUrl, mode };
}

async function fetchArticleHtml(targetUrl, context) {
  let response;
  try {
    response = await fetchWithRedirectValidation(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,application/epub+zip;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
      },
    });
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'Upstream request timed out.', context.allowedOrigin);
    }
    if (err instanceof Response) return err;
    return errorResponse(502, `Fetch failed: ${getErrorMessage(err)}`, context.allowedOrigin);
  }

  if (!response.ok) {
    return errorResponse(502, `Upstream returned ${response.status}.`, context.allowedOrigin);
  }

  const ct = response.headers.get('content-type') || '';

  // PDF response — return binary with higher size limit
  if (ct.includes('application/pdf')) {
    return fetchBinaryResponse(response, targetUrl, context, 'PDF', 'application/pdf', '%PDF-');
  }

  // EPUB response — return binary (EPUB is a ZIP archive, magic bytes: PK\x03\x04)
  if (ct.includes('application/epub') || ct.includes('application/epub+zip')) {
    return fetchBinaryResponse(response, targetUrl, context, 'EPUB', 'application/epub+zip', 'PK\x03\x04');
  }

  if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
    return errorResponse(400, 'URL does not point to an HTML page, PDF, or EPUB.', context.allowedOrigin);
  }

  const tooLargeByHeader = isResponseTooLargeByHeader(response);
  if (tooLargeByHeader) {
    return errorResponse(400, 'Response too large (>2 MB).', context.allowedOrigin);
  }

  const html = await response.text();
  if (html.length > MAX_RESPONSE_BYTES) {
    return errorResponse(400, 'Response too large (>2 MB).', context.allowedOrigin);
  }

  return new Response(html, {
    status: 200,
    headers: successHeaders(context, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Final-URL': response.url || targetUrl,
    }),
  });
}

async function fetchBinaryResponse(response, targetUrl, context, label, contentType, magicPrefix) {
  const tooLarge = isResponseTooLargeByHeader(response, MAX_PDF_RESPONSE_BYTES);
  if (tooLarge) {
    return errorResponse(400, `${label} too large (>10 MB).`, context.allowedOrigin);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_RESPONSE_BYTES) {
    return errorResponse(400, `${label} too large (>10 MB).`, context.allowedOrigin);
  }

  // Validate magic bytes
  const header = new Uint8Array(buffer, 0, Math.min(magicPrefix.length, buffer.byteLength));
  const magic = String.fromCharCode(...header);
  if (!magic.startsWith(magicPrefix)) {
    return errorResponse(400, `Response claims to be ${label} but has invalid format.`, context.allowedOrigin);
  }

  return new Response(buffer, {
    status: 200,
    headers: successHeaders(context, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Final-URL': response.url || targetUrl,
    }),
  });
}

async function fetchViaJina(targetUrl, context) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/markdown',
  };
  if (context.jinaKey) {
    headers.Authorization = `Bearer ${context.jinaKey}`;
  }

  let response;
  try {
    response = await fetchWithTimeout(`https://r.jina.ai/${encodeURIComponent(targetUrl)}`, {
      headers,
      redirect: 'follow',
    });
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'Jina Reader request timed out.', context.allowedOrigin);
    }
    return errorResponse(502, `Jina Reader fetch failed: ${getErrorMessage(err)}`, context.allowedOrigin);
  }

  if (!response.ok) {
    const snippet = (await response.text()).slice(0, 240);
    return errorResponse(502, `Jina Reader returned ${response.status}: ${snippet}`, context.allowedOrigin);
  }

  const tooLargeByHeader = isResponseTooLargeByHeader(response);
  if (tooLargeByHeader) {
    return errorResponse(400, 'Response too large (>2 MB).', context.allowedOrigin);
  }

  const markdown = await response.text();
  if (markdown.length > MAX_RESPONSE_BYTES) {
    return errorResponse(400, 'Response too large (>2 MB).', context.allowedOrigin);
  }

  const finalUrl =
    response.headers.get('X-Final-URL')
    || response.headers.get('x-url')
    || response.url
    || targetUrl;

  return new Response(markdown, {
    status: 200,
    headers: successHeaders(context, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Final-URL': finalUrl,
    }),
  });
}

async function translateText(text, from, to, context) {
  const validationError = validateTranslateParams(text, from, to, context.allowedOrigin);
  if (validationError) return validationError;

  const apiUrl = buildTranslateApiUrl(text, from, to);

  let resp;
  try {
    resp = await fetchWithTimeout(apiUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (err) {
    if (isAbortError(err)) {
      return errorResponse(504, 'Translation request timed out after 10s.', context.allowedOrigin);
    }
    return errorResponse(502, `Translation fetch failed: ${getErrorMessage(err)}`, context.allowedOrigin);
  }

  if (!resp.ok) {
    const snippet = (await resp.text()).slice(0, 200);
    return errorResponse(
      502,
      `Google Translate API returned ${resp.status}: ${snippet}`,
      context.allowedOrigin,
    );
  }

  const data = await resp.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    return errorResponse(
      502,
      `Unexpected Google Translate response format: ${JSON.stringify(data).slice(0, 200)}`,
      context.allowedOrigin,
    );
  }

  const translatedText = data[0].map((segment) => segment[0]).join('');
  const detectedLang = data[2] || from;

  return new Response(JSON.stringify({ translatedText, detectedLang }), {
    status: 200,
    headers: successHeaders(context, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    }),
  });
}

function validateTranslateParams(text, from, to, allowedOrigin) {
  if (!text || typeof text !== 'string') {
    return errorResponse(400, 'Missing or invalid "text" field (must be a non-empty string).', allowedOrigin);
  }
  if (text.length > MAX_TRANSLATE_CHARS) {
    return errorResponse(400, `Text too long (${text.length} chars, max ${MAX_TRANSLATE_CHARS}).`, allowedOrigin);
  }
  if (!from || (!LANG_CODE_RE.test(from) && from !== 'auto')) {
    return errorResponse(400, `Invalid "from" language code: "${from}".`, allowedOrigin);
  }
  if (!to || !LANG_CODE_RE.test(to)) {
    return errorResponse(400, `Invalid "to" language code: "${to}".`, allowedOrigin);
  }
  return null;
}

function buildTranslateApiUrl(text, from, to) {
  return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
}

function successHeaders(context, extra = {}) {
  return {
    ...corsHeaders(context.allowedOrigin),
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(context.rateCheck.remaining),
    ...extra,
  };
}

/**
 * Fetch with manual redirect following + SSRF validation on each hop.
 * Prevents DNS rebinding / redirect-chained private IP bypass.
 */
async function fetchWithRedirectValidation(url, init = {}) {
  let currentUrl = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetchWithTimeout(currentUrl, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect with no Location header');

      let redirectUrl;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        throw new Error('Invalid redirect URL');
      }

      if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
        throw new Error('Redirect to non-HTTP protocol');
      }
      if (isPrivateHost(redirectUrl.hostname)) {
        throw new Error('Redirect to private/internal address blocked');
      }

      currentUrl = redirectUrl.href;
      continue;
    }

    // Attach final URL so callers can read it
    Object.defineProperty(response, 'url', { value: currentUrl, writable: false });
    return response;
  }
  throw new Error('Too many redirects');
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isResponseTooLargeByHeader(response, limit = MAX_RESPONSE_BYTES) {
  const contentLength = response.headers.get('content-length');
  if (!contentLength) return false;
  return parseInt(contentLength, 10) > limit;
}

function noContentResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
    'Access-Control-Expose-Headers': 'X-Final-URL, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
  };
}

function errorResponse(status, message, origin, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function checkRateLimit(clientIp) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitMap.get(clientIp);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(clientIp, timestamps);
  }

  while (timestamps.length > 0 && timestamps[0] <= windowStart) {
    timestamps.shift();
  }

  const remaining = RATE_LIMIT_MAX - timestamps.length;
  if (remaining <= 0) {
    const retryAfterMs = timestamps[0] - windowStart;
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(retryAfterMs / 1000) };
  }

  timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, retryAfter: 0 };
}

function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_WINDOW_MS) return;

  lastCleanup = now;
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of rateLimitMap) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
      rateLimitMap.delete(ip);
    }
  }
}

function isPrivateHost(hostname) {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isAbortError(err) {
  return Boolean(err && typeof err === 'object' && err.name === 'AbortError');
}

function getErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
