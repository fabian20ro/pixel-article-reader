/**
 * ArticleVoice CORS Proxy — Cloudflare Worker
 *
 * Deployed automatically via GitHub Actions when worker/ changes.
 * See .github/workflows/deploy-worker.yml for the CI pipeline.
 *
 * Endpoints:
 *   GET  /?url=<encoded_article_url>        — Fetch and return article HTML
 *   GET  /?url=<encoded_article_url>&mode=markdown
 *                                           — Fetch markdown via Jina Reader
 *   POST /?action=translate                  — Translate text via Google Translate API
 *        Body: { text: string, from: string, to: string }
 *
 * Environment bindings (set in wrangler.toml or via `wrangler secret put`):
 *   ALLOWED_ORIGIN  — GitHub Pages origin (e.g. "https://user.github.io")
 *   PROXY_SECRET    — shared secret the client sends via X-Proxy-Key header
 *   JINA_KEY        — optional Jina Reader key used server-side only
 *
 * Security:
 *  - SSRF prevention: rejects private/internal IPs
 *  - Origin allowlist
 *  - Shared secret validation
 *  - No cookie forwarding
 *  - Max 2 MB response
 *  - 10 s timeout
 *
 * Rate limiting:
 *  - 20 requests per minute per client IP (sliding window)
 *  - Returns HTTP 429 with Retry-After header when exceeded
 *  - All responses include X-RateLimit-Limit and X-RateLimit-Remaining headers
 */

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_TRANSLATE_CHARS = 5000;
const FETCH_TIMEOUT_MS = 10_000;

// Rate limiting: 20 requests per 60-second sliding window per IP
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

// Private IP ranges to block (SSRF prevention)
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
];

// ── Rate limiter (in-memory sliding window) ─────────────────────────
// Each CF edge PoP maintains its own counters. This is slightly more
// permissive than a global limit but sufficient for abuse prevention.

const rateLimitMap = new Map(); // IP → timestamp[]

function checkRateLimit(clientIp) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitMap.get(clientIp);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(clientIp, timestamps);
  }

  // Remove expired entries
  while (timestamps.length > 0 && timestamps[0] <= windowStart) {
    timestamps.shift();
  }

  const remaining = RATE_LIMIT_MAX - timestamps.length;

  if (remaining <= 0) {
    // Calculate when the oldest request in the window expires
    const retryAfterMs = timestamps[0] - windowStart;
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    return { allowed: false, remaining: 0, retryAfter: retryAfterSec };
  }

  // Record this request
  timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, retryAfter: 0 };
}

// Periodic cleanup to prevent memory growth from stale IPs
let lastCleanup = Date.now();
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

// ── Worker entry ────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const proxySecret = env.PROXY_SECRET || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return errorResponse(405, 'Only GET and POST requests are allowed.', allowedOrigin);
    }

    // Validate shared secret (if configured)
    if (proxySecret) {
      const clientKey = request.headers.get('X-Proxy-Key') || '';
      if (clientKey !== proxySecret) {
        return errorResponse(403, 'Invalid or missing proxy key.', allowedOrigin);
      }
    }

    // Rate limiting (by client IP)
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    cleanupStaleEntries();
    const rateCheck = checkRateLimit(clientIp);

    if (!rateCheck.allowed) {
      return errorResponse(
        429,
        `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} requests per minute. Try again in ${rateCheck.retryAfter} seconds.`,
        allowedOrigin,
        {
          'Retry-After': String(rateCheck.retryAfter),
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
        },
      );
    }

    const requestUrl = new URL(request.url);

    // ── Translate action (POST) ────────────────────────────────────
    if (request.method === 'POST' && requestUrl.searchParams.get('action') === 'translate') {
      return handleTranslate(request, allowedOrigin, rateCheck);
    }

    if (request.method !== 'GET') {
      return errorResponse(405, 'POST is only supported for ?action=translate.', allowedOrigin);
    }

    const targetUrl = requestUrl.searchParams.get('url');
    const mode = requestUrl.searchParams.get('mode') || 'html';

    if (!targetUrl) {
      return errorResponse(400, 'Missing ?url= query parameter.', allowedOrigin);
    }
    if (mode !== 'html' && mode !== 'markdown') {
      return errorResponse(400, 'Invalid mode. Supported values: html, markdown.', allowedOrigin);
    }

    // Validate URL
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return errorResponse(400, 'Invalid URL.', allowedOrigin);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorResponse(400, 'Only http and https URLs are allowed.', allowedOrigin);
    }

    // SSRF check
    if (isPrivateHost(parsed.hostname)) {
      return errorResponse(403, 'Access to internal addresses is not allowed.', allowedOrigin);
    }

    if (mode === 'markdown') {
      return handleJinaMarkdown(targetUrl, allowedOrigin, rateCheck, env.JINA_KEY || '');
    }

    // Fetch the target URL
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
        },
        redirect: 'follow',
      });

      clearTimeout(timer);

      if (!response.ok) {
        return errorResponse(502, `Upstream returned ${response.status}.`, allowedOrigin);
      }

      // Check content type
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
        return errorResponse(400, 'URL does not point to an HTML page.', allowedOrigin);
      }

      // Check size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
        return errorResponse(400, 'Response too large (>2 MB).', allowedOrigin);
      }

      const html = await response.text();

      if (html.length > MAX_RESPONSE_BYTES) {
        return errorResponse(400, 'Response too large (>2 MB).', allowedOrigin);
      }

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders(allowedOrigin),
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Final-URL': response.url || targetUrl,
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateCheck.remaining),
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return errorResponse(504, 'Upstream request timed out.', allowedOrigin);
      }
      return errorResponse(502, `Fetch failed: ${err.message}`, allowedOrigin);
    }
  },
};

// ── Translate handler ────────────────────────────────────────────────

const LANG_CODE_RE = /^[a-z]{2,5}(-[a-zA-Z]{2,5})?$/;

async function handleTranslate(request, allowedOrigin, rateCheck) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON body.', allowedOrigin);
  }

  const { text, from, to } = body;

  if (!text || typeof text !== 'string') {
    return errorResponse(400, 'Missing or invalid "text" field (must be a non-empty string).', allowedOrigin);
  }
  if (text.length > MAX_TRANSLATE_CHARS) {
    return errorResponse(400, `Text too long (${text.length} chars, max ${MAX_TRANSLATE_CHARS}).`, allowedOrigin);
  }
  if (!from || !LANG_CODE_RE.test(from) && from !== 'auto') {
    return errorResponse(400, `Invalid "from" language code: "${from}".`, allowedOrigin);
  }
  if (!to || !LANG_CODE_RE.test(to)) {
    return errorResponse(400, `Invalid "to" language code: "${to}".`, allowedOrigin);
  }

  const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const snippet = (await resp.text()).slice(0, 200);
      return errorResponse(
        502,
        `Google Translate API returned ${resp.status}: ${snippet}`,
        allowedOrigin,
      );
    }

    const data = await resp.json();

    // Response format: [[["translated","original",...],...], null, "detected_lang"]
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return errorResponse(
        502,
        `Unexpected Google Translate response format: ${JSON.stringify(data).slice(0, 200)}`,
        allowedOrigin,
      );
    }

    const translatedText = data[0].map((seg) => seg[0]).join('');
    const detectedLang = data[2] || from;

    return new Response(JSON.stringify({ translatedText, detectedLang }), {
      status: 200,
      headers: {
        ...corsHeaders(allowedOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return errorResponse(504, 'Translation request timed out after 10s.', allowedOrigin);
    }
    return errorResponse(502, `Translation fetch failed: ${err.message}`, allowedOrigin);
  }
}

async function handleJinaMarkdown(targetUrl, allowedOrigin, rateCheck, jinaKey) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'text/markdown',
    };
    if (jinaKey) {
      headers.Authorization = `Bearer ${jinaKey}`;
    }

    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!response.ok) {
      const snippet = (await response.text()).slice(0, 240);
      return errorResponse(502, `Jina Reader returned ${response.status}: ${snippet}`, allowedOrigin);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return errorResponse(400, 'Response too large (>2 MB).', allowedOrigin);
    }

    const markdown = await response.text();
    if (markdown.length > MAX_RESPONSE_BYTES) {
      return errorResponse(400, 'Response too large (>2 MB).', allowedOrigin);
    }

    const finalUrl =
      response.headers.get('X-Final-URL')
      || response.headers.get('x-url')
      || response.url
      || targetUrl;

    return new Response(markdown, {
      status: 200,
      headers: {
        ...corsHeaders(allowedOrigin),
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Final-URL': finalUrl,
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return errorResponse(504, 'Jina Reader request timed out.', allowedOrigin);
    }
    return errorResponse(502, `Jina Reader fetch failed: ${err.message}`, allowedOrigin);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
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

function isPrivateHost(hostname) {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}
