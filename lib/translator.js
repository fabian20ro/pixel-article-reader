/**
 * Text translation via the CORS proxy's translate endpoint.
 * Batches paragraphs to minimize API calls while staying under per-request limits.
 */
const MAX_BATCH_CHARS = 3000;
const MAX_CONCURRENT = 3;
const BATCH_SEPARATOR = '\n\n';
/**
 * Translate an array of paragraphs via the worker's translate endpoint.
 * Returns a translated array with the same length as the input.
 */
export async function translateParagraphs(paragraphs, sourceLang, targetLang, proxyBase, proxySecret) {
    if (paragraphs.length === 0)
        return [];
    const batches = buildBatches(paragraphs);
    const translated = await translateBatches(batches, sourceLang, targetLang, proxyBase, proxySecret);
    // Flatten translated batches back into individual paragraphs
    const result = [];
    for (const batch of translated) {
        const parts = batch.split(BATCH_SEPARATOR);
        result.push(...parts);
    }
    // Ensure output length matches input — trim or pad if the API merged/split paragraphs
    if (result.length > paragraphs.length) {
        // API may have split text differently; merge extras into the last expected slot
        while (result.length > paragraphs.length) {
            const extra = result.pop();
            result[result.length - 1] += ' ' + extra;
        }
    }
    else if (result.length < paragraphs.length) {
        // Pad with empty strings (shouldn't happen, but be safe)
        while (result.length < paragraphs.length) {
            result.push('');
        }
    }
    return result;
}
/** Group paragraphs into batches that stay under MAX_BATCH_CHARS. */
export function buildBatches(paragraphs) {
    const batches = [];
    let current = '';
    for (const p of paragraphs) {
        if (current.length === 0) {
            current = p;
        }
        else if (current.length + BATCH_SEPARATOR.length + p.length <= MAX_BATCH_CHARS) {
            current += BATCH_SEPARATOR + p;
        }
        else {
            batches.push(current);
            current = p;
        }
    }
    if (current.length > 0) {
        batches.push(current);
    }
    return batches;
}
/** Translate batches with concurrency limit. */
async function translateBatches(batches, sourceLang, targetLang, proxyBase, proxySecret) {
    const results = new Array(batches.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < batches.length) {
            const idx = nextIndex++;
            results[idx] = await translateSingle(batches[idx], sourceLang, targetLang, proxyBase, proxySecret, idx, batches.length);
        }
    }
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, batches.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
/** Send a single text chunk to the worker translate endpoint. */
async function translateSingle(text, sourceLang, targetLang, proxyBase, proxySecret, batchIndex, batchTotal) {
    const url = `${proxyBase}?action=translate`;
    const headers = {
        'Content-Type': 'application/json',
    };
    if (proxySecret) {
        headers['X-Proxy-Key'] = proxySecret;
    }
    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ text, from: sourceLang, to: targetLang }),
        });
    }
    catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not reach translation service: ${cause}`);
    }
    if (!resp.ok) {
        let detail = '';
        try {
            const body = await resp.json();
            if (body.error)
                detail = body.error;
        }
        catch { /* ignore parse errors */ }
        const batchInfo = batchIndex != null && batchTotal != null
            ? ` (batch ${batchIndex + 1}/${batchTotal})`
            : '';
        if (resp.status === 429) {
            const retryAfter = resp.headers.get('Retry-After');
            const waitMsg = retryAfter ? ` Try again in ${retryAfter}s.` : '';
            throw new Error(`Translation rate limited${batchInfo}.${waitMsg}${detail ? ' ' + detail : ''}`);
        }
        throw new Error(`Translation failed with status ${resp.status}${batchInfo}: ${detail || resp.statusText}`);
    }
    const data = await resp.json();
    return data.translatedText;
}
