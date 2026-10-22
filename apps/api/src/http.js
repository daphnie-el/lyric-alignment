import { MAX_BODY_BYTES } from './config.js';

export function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/**
 * Thrown by handlers. Transport and shape failures carry a `hint`; the 409
 * carries the server's current state instead, so a stale client can reconcile
 * from the rejection rather than making a second request.
 */
export class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(typeof body?.error === 'string' ? body.error : String(status));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const badRequest = (error, hint, extra = {}) => new HttpError(400, { error, hint, ...extra });
export const unauthorized = (hint) => new HttpError(401, { error: 'unauthorized', hint });
export const notFound = (hint) => new HttpError(404, { error: 'not_found', hint });

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type && type !== 'application/json') {
      return reject(badRequest('unsupported_media_type', `send content-type: application/json, got "${type}"`));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, { error: 'payload_too_large', hint: `request body must be under ${MAX_BODY_BYTES} bytes` }));
        // Drain input so the caller can still receive a useful 413 response.
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return reject(badRequest('empty_body', 'this route expects a JSON object body'));
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(badRequest('invalid_body', 'body must be a JSON object'));
        }
        resolve(parsed);
      } catch (e) {
        reject(badRequest('invalid_json', `body is not valid JSON: ${e.message}`));
      }
    });
    req.on('error', reject);
  });
}
