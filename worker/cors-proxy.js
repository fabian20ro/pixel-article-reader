/**
 * ArticleVoice CORS Proxy — Cloudflare Worker
 *
 * Deployed automatically via GitHub Actions when worker/ changes.
 * See .github/workflows/deploy-worker.yml for the CI pipeline.
 *
 * Accepts:  GET /?url=<encoded_article_url>
 * Returns:  The HTML of the article with appropriate CORS headers.
 *
 * Environment bindings (set in wrangler.toml or via `wrangler secret put`):
 *   ALLOWED_ORIGIN  — GitHub Pages origin (e.g. "https://user.github.io")
 *   PROXY_SECRET    — shared secret the client sends via X-Proxy-Key header
 *
 * Security:
 *  - SSRF prevention: rejects private/internal IPs
 *  - Origin allowlist
 *  - Shared secret validation
 *  - No cookie forwarding
 *  - Max 2 MB response
 *  - 10 s timeout
 */

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 10_000;

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

    if (request.method !== 'GET') {
      return errorResponse(405, 'Only GET requests are allowed.', allowedOrigin);
    }

    // Validate shared secret (if configured)
    if (proxySecret) {
      const clientKey = request.headers.get('X-Proxy-Key') || '';
      if (clientKey !== proxySecret) {
        return errorResponse(403, 'Invalid or missing proxy key.', allowedOrigin);
      }
    }

    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
      return errorResponse(400, 'Missing ?url= query parameter.', allowedOrigin);
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

// ── Helpers ─────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
  };
}

function errorResponse(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
    },
  });
}

function isPrivateHost(hostname) {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}
