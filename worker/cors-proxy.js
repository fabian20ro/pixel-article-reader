/**
 * ArticleVoice CORS Proxy — Cloudflare Worker
 *
 * Deploy separately on Cloudflare Workers (free tier).
 *
 * Accepts:  GET /?url=<encoded_article_url>
 * Returns:  The HTML of the article with appropriate CORS headers.
 *
 * Security:
 *  - SSRF prevention: rejects private/internal IPs
 *  - Origin allowlist (configure ALLOWED_ORIGIN below)
 *  - No cookie forwarding
 *  - Max 2 MB response
 *  - 10 s timeout
 */

// ── Configuration ───────────────────────────────────────────────────

// Set this to your GitHub Pages origin (e.g., "https://user.github.io")
const ALLOWED_ORIGIN = '*'; // TODO: restrict to your GH Pages origin in production

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
  async fetch(request) {
    // Only allow GET
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'GET') {
      return errorResponse(405, 'Only GET requests are allowed.');
    }

    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
      return errorResponse(400, 'Missing ?url= query parameter.');
    }

    // Validate URL
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return errorResponse(400, 'Invalid URL.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorResponse(400, 'Only http and https URLs are allowed.');
    }

    // SSRF check
    if (isPrivateHost(parsed.hostname)) {
      return errorResponse(403, 'Access to internal addresses is not allowed.');
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
        return errorResponse(502, `Upstream returned ${response.status}.`);
      }

      // Check content type
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
        return errorResponse(400, 'URL does not point to an HTML page.');
      }

      // Check size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
        return errorResponse(400, 'Response too large (>2 MB).');
      }

      const html = await response.text();

      if (html.length > MAX_RESPONSE_BYTES) {
        return errorResponse(400, 'Response too large (>2 MB).');
      }

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        return errorResponse(504, 'Upstream request timed out.');
      }
      return errorResponse(502, `Fetch failed: ${err.message}`);
    }
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
    },
  });
}

function isPrivateHost(hostname) {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}
