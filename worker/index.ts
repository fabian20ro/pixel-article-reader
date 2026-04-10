/**
 * Article Local Reader — Cloudflare Worker
 *
 * Implements CORS proxy and REST API for article extraction.
 */

import { parse } from 'linkedom';
import { extractArticle } from '../src/lib/extractors/extract-url.js';

export interface Env {
  ALLOWED_ORIGIN: string;
  PROXY_SECRET: string;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB (HTML articles)
const MAX_PDF_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB (PDF documents)
const MAX_TRANSLATE_CHARS = 5000;
const MAX_TTS_CHARS = 200;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const PRIVATE_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^fd/i, /^localhost$/i, /^::ffff:127\./i, /^::ffff:10\./i, /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, /^::ffff:192\.168\./i, /^::ffff:169\.254\./i, /^::ffff:0\./i, /^\[::1\]$/, /^\[::ffff:/i,
];

const LANG_CODE_RE = /^[a-z]{2,5}(-[a-zA-Z]{2,5})?$/;

const rateLimitMap = new Map<string, number[]>();
let lastCleanup = Date.now();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return handleOptions(origin, env.ALLOWED_ORIGIN);
    }

    // Auth check
    if (env.PROXY_SECRET) {
      const key = request.headers.get('X-Proxy-Key') || url.searchParams.get('key');
      if (key !== env.PROXY_SECRET) {
        return errorResponse(403, 'Forbidden: Invalid proxy key.', env.ALLOWED_ORIGIN);
      }
    }

    // Rate limiting
    const rateCheck = applyRateLimit(request);
    if (!rateCheck.allowed) {
      return errorResponse(
        429,
        `Rate limit exceeded. Try again in ${rateCheck.retryAfter} seconds.`,
        env.ALLOWED_ORIGIN,
        { 'Retry-After': String(rateCheck.retryAfter) }
      );
    }

    // API Route: /parse (Markdown API for AI Agents)
    if (url.pathname === '/parse') {
      return handleParseRequest(request, env);
    }

    // Action-based Routes (Legacy PWA)
    const action = url.searchParams.get('action');
    if (action === 'translate') return handleTranslate(request, env);
    if (action === 'tts') return handleTts(request, env);

    // Default: CORS Proxy for raw content
    if (url.searchParams.has('url')) {
      return handleProxyFetch(url.searchParams.get('url')!, env);
    }

    return errorResponse(404, 'Not Found', env.ALLOWED_ORIGIN);
  }
};

/** Handle Markdown extraction API. */
async function handleParseRequest(request: Request, env: Env): Promise<Response> {
  let targetUrl: string | null = null;

  if (request.method === 'POST') {
    try {
      const body = await request.json() as { url?: string };
      targetUrl = body.url || null;
    } catch {
      return errorResponse(400, 'Invalid JSON body.', env.ALLOWED_ORIGIN);
    }
  } else {
    targetUrl = new URL(request.url).searchParams.get('url');
  }

  if (!targetUrl) return errorResponse(400, 'Missing url parameter.', env.ALLOWED_ORIGIN);

  try {
    const article = await extractArticle(
      targetUrl,
      '', // direct
      undefined,
      LinkedomDOMParser as any,
      undefined,
      fetch
    );

    return new Response(article.markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'X-Resolved-Url': article.resolvedUrl,
      }
    });
  } catch (err: unknown) {
    return errorResponse(500, `Extraction failed: ${String(err)}`, env.ALLOWED_ORIGIN);
  }
}

/** Proxy raw content bytes with validation. */
async function handleProxyFetch(targetUrl: string, env: Env): Promise<Response> {
  try {
    const resp = await fetchWithRedirectValidation(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,application/epub+zip;q=0.8,*/*;q=0.7',
      }
    });

    if (!resp.ok) return errorResponse(502, `Upstream returned ${resp.status}`, env.ALLOWED_ORIGIN);

    const ct = resp.headers.get('content-type') || '';
    const isBinary = ct.includes('pdf') || ct.includes('epub');
    const limit = isBinary ? MAX_PDF_RESPONSE_BYTES : MAX_RESPONSE_BYTES;

    const contentLength = resp.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > limit) {
      return errorResponse(400, 'Response too large.', env.ALLOWED_ORIGIN);
    }

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
    headers.set('Access-Control-Expose-Headers', 'X-Final-URL, Content-Type');
    headers.set('X-Final-URL', resp.url);
    headers.set('Content-Type', ct);

    return new Response(resp.body, { status: 200, headers });
  } catch (err: unknown) {
    return errorResponse(502, `Fetch failed: ${String(err)}`, env.ALLOWED_ORIGIN);
  }
}

async function handleTranslate(request: Request, env: Env): Promise<Response> {
  let text = '';
  let from = 'auto';
  let to = 'en';

  if (request.method === 'POST') {
    const body = await request.json() as any;
    text = body.text;
    from = body.from || 'auto';
    to = body.to || 'en';
  } else {
    const params = new URL(request.url).searchParams;
    text = params.get('text') || '';
    from = params.get('from') || 'auto';
    to = params.get('to') || 'en';
  }

  if (!text || text.length > MAX_TRANSLATE_CHARS) return errorResponse(400, 'Invalid text.', env.ALLOWED_ORIGIN);
  if (!LANG_CODE_RE.test(to)) return errorResponse(400, 'Invalid lang.', env.ALLOWED_ORIGIN);

  const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  
  try {
    const resp = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
    const data = await resp.json() as any;
    const translatedText = data[0].map((s: any) => s[0]).join('');
    const detectedLang = data[2] || from;

    return new Response(JSON.stringify({ translatedText, detectedLang }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      }
    });
  } catch (err) {
    return errorResponse(502, 'Translation failed.', env.ALLOWED_ORIGIN);
  }
}

async function handleTts(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const text = params.get('text') || '';
  const lang = params.get('lang') || 'en';

  if (!text || text.length > MAX_TTS_CHARS) return errorResponse(400, 'Invalid text.', env.ALLOWED_ORIGIN);

  const ttsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  
  try {
    const resp = await fetch(ttsUrl, { headers: { 'User-Agent': USER_AGENT } });
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
        'Cache-Control': 'public, max-age=3600',
      }
    });
  } catch (err) {
    return errorResponse(502, 'TTS failed.', env.ALLOWED_ORIGIN);
  }
}

/** Lightweight DOMParser polyfill. */
class LinkedomDOMParser {
  parseFromString(html: string, _type: string) {
    const { document } = parse(html);
    return document;
  }
}

async function fetchWithRedirectValidation(url: string, init: RequestInit = {}) {
  let currentUrl = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) throw new Error('Redirect without location');
      const next = new URL(loc, currentUrl);
      if (isPrivateHost(next.hostname)) throw new Error('Private IP blocked');
      currentUrl = next.href;
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}

function applyRateLimit(request: Request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return { allowed: true, remaining: RATE_LIMIT_MAX - timestamps.length, retryAfter: 0 };
}

function isPrivateHost(hostname: string) {
  return PRIVATE_IP_PATTERNS.some(re => re.test(hostname));
}

function handleOptions(origin: string | null, allowed: string) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Key',
      'Access-Control-Max-Age': '86400',
    }
  });
}

function errorResponse(status: number, message: string, allowed: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowed || '*',
      ...extra
    }
  });
}
