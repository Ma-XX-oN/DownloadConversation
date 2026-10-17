import { createHash } from 'node:crypto';

export const FORMAT = 'dc-secret-marker/1';
const MAX_MARKER = 342;
const DOMAIN = Buffer.from('DC-SECRET-MARKER-V1\0', 'ascii');
const SYNTH = Buffer.from('DC-SECRET-SYNTH-V1\0', 'ascii');
const HEX = '0123456789abcdef';
const URL64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const hash = bytes => createHash('sha256').update(bytes).digest();
const shaHex = bytes => hash(bytes).toString('hex');
const decimal = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const width = value => [Buffer.byteLength(value, 'utf8'), value.length];

function validate(type, params) {
  if (type === 'U' || type === 'P') return params === undefined;
  if (type === 'H' || type === 'B') {
    if (!decimal(params)) return false;
    const n = Number(params);
    return type === 'H' ? n >= 2 && n <= 256 && n % 2 === 0 :
      n >= 4 && n <= 256 && n % 4 !== 1;
  }
  if (type === 'O') return typeof params === 'string' &&
    /^[1-4]{1,128}$/.test(params);
  if (type === 'J') {
    if (typeof params !== 'string' ||
        !/^[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*$/.test(params)) return false;
    const n = params.split(',').map(Number);
    return n.every(x => x >= 4 && x <= 512) &&
      n.reduce((a, b) => a + b, 0) <= 1024;
  }
  return false;
}

function canonicalBase64(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) &&
    value.length % 4 !== 1 &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}
function jsonObjectPart(value) {
  if (!canonicalBase64(value)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' &&
      !Array.isArray(parsed);
  } catch {
    return false;
  }
}
function jsonPartOfLength(length) {
  // Canonical JSON object forms with controllable byte counts.
  for (const prefix of ['{"":', '{"a":"', '{"a":', '{"x":']) {
    const suffix = prefix.endsWith('"') ? '"}' : '}';
    for (let n = 0; n <= 512; n++) {
      const value = prefix + (prefix.endsWith('"') ? 'a'.repeat(n) :
        n ? '1'.repeat(n) : '0') + suffix;
      const encoded = Buffer.from(value).toString('base64url');
      if (encoded.length === length && jsonObjectPart(encoded)) return encoded;
    }
  }
  throw new Error('UNSUPPORTED_JWT_SHAPE');
}
function bytesFromSeed(seed) {
  let count = 0, pool = Buffer.alloc(0);
  return () => {
    if (pool.length === 0) {
      if (count > 0xffffffff) throw new Error('SYNTHETIC_STREAM_EXHAUSTED');
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(count++);
      pool = hash(Buffer.concat([seed, counter]));
    }
    const value = pool[0];
    pool = pool.subarray(1);
    return value;
  };
}
function canonicalToken(length, next) {
  if (length % 4 === 1) throw new Error('UNSUPPORTED_B64_SHAPE');
  const rem = length % 4;
  const n = Math.floor(length / 4) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const bytes = Buffer.alloc(n);
  for (let i = 0; i < n; i++) bytes[i] = next();
  const value = bytes.toString('base64url');
  if (value.length !== length) throw new Error('INVALID_B64_SHAPE');
  return value;
}
function reconstruct(type, params, seed) {
  const next = bytesFromSeed(seed);
  const generate = (alphabet, count) =>
    Array.from({ length: count }, () => alphabet[next() % alphabet.length]).join('');
  if (type === 'U') {
    const value = generate(HEX, 32);
    return value.slice(0, 8) + '-' + value.slice(8, 12) +
      '-4' + value.slice(13, 16) + '-' + '89ab'[next() % 4] +
      value.slice(17, 20) + '-' + value.slice(20);
  }
  if (type === 'P') return 'g-p-' + generate(HEX, 32);
  if (type === 'H') return generate(HEX, Number(params));
  if (type === 'B') return canonicalToken(Number(params), next);
  if (type === 'J') {
    const [h, p, s] = params.split(',').map(Number);
    const signature = canonicalToken(s, next);
    return jsonPartOfLength(h) + '.' + jsonPartOfLength(p) + '.' + signature;
  }
  if (type === 'O') {
    const pools = ['QWERTY', 'éñø', '界語漢', '𐐀😀🦊'];
    return [...params].map(d => {
      const choices = [...pools[Number(d) - 1]];
      return choices[next() % choices.length];
    }).join('');
  }
  throw new Error('UNKNOWN_MARKER_TYPE');
}
function verifyReplacement(type, params, value) {
  if (type === 'U') return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  if (type === 'P') return /^g-p-[0-9a-f]{32}$/.test(value);
  if (type === 'H') return /^[0-9a-f]+$/.test(value) && value.length === Number(params);
  if (type === 'B') return canonicalBase64(value) && value.length === Number(params);
  if (type === 'J') {
    const parts = value.split('.');
    return parts.length === 3 && parts.map(x => x.length).join(',') === params &&
      parts.slice(0, 2).every(jsonObjectPart) && canonicalBase64(parts[2]);
  }
  if (type === 'O') return [...value].map(c => Buffer.byteLength(c)).join('') === params;
  return false;
}

// Type identification is anchored to a complete logical value, never substring text.
// Consumers must explicitly opt in to a supported classified value context.
const ACTIVE_CONTEXTS = Object.freeze([
  'json.string', 'sse.data.json.string', 'http.header.value',
  'http.query.value', 'ws.text.json.string'
]);
const contexts = Object.freeze(Object.fromEntries(ACTIVE_CONTEXTS.map(c => [c, true])));
export const TYPE_REGISTRY = Object.freeze(Object.fromEntries(
  ['U', 'H', 'B', 'P', 'J', 'O'].map(type => [type, Object.freeze({
    contexts,
    identify(value, context) {
      if (contexts[context] !== true || typeof value !== 'string') return false;
      switch (type) {
        case 'U': return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
        case 'P': return /^g-p-[0-9a-f]{32}$/.test(value);
        case 'H': return value.length >= 2 && value.length <= 256 &&
          value.length % 2 === 0 && /^[0-9a-f]+$/.test(value);
        case 'B': return value.length >= 4 && value.length <= 256 &&
          canonicalBase64(value);
        case 'J': {
          const parts = value.split('.');
          return parts.length === 3 &&
            parts.every(part => part.length >= 4 && part.length <= 512) &&
            parts.reduce((total, part) => total + part.length, 0) <= 1024 &&
            parts.slice(0, 2).every(jsonObjectPart) &&
            canonicalBase64(parts[2]);
        }
        case 'O': return false; // requires explicit opaque-secret span metadata
        default: return false;
      }
    },
    reconstruct(params, randomSource) {
      if (!validate(type, params)) throw new Error('UNSUPPORTED_TYPE_OR_PARAMS');
      if (typeof randomSource !== 'function') throw new TypeError('RANDOM_SOURCE_REQUIRED');
      return reconstruct(type, params, randomSource());
    }
  })])
));

export function identifyTypes(value, context, allowedTypes = Object.keys(TYPE_REGISTRY)) {
  const found = allowedTypes.filter(t =>
    TYPE_REGISTRY[t]?.identify(value, context) === true);
  if (found.length > 1) throw new Error('AMBIGUOUS_SECRET_TYPE');
  return found;
}

export function parseMarker(marker) {
  if (typeof marker !== 'string' || marker.length > MAX_MARKER) {
    throw new Error('MARKER_TOO_LONG_OR_INVALID');
  }
  const match = /^\[([0-9a-f]{32})\/([A-Z])\/([0-9a-f]{48})(?:\/([a-z0-9,]{1,256}))?\]$/.exec(marker);
  if (!match) throw new Error('MALFORMED_MARKER');
  const [, check, type, id, params] = match;
  if (!validate(type, params)) throw new Error('UNSUPPORTED_TYPE_OR_PARAMS');
  const body = type + '/' + id + (params === undefined ? '' : '/' + params);
  const expected = shaHex(Buffer.concat([DOMAIN, Buffer.from(body, 'ascii')])).slice(0, 32);
  if (check !== expected) throw new Error('INVALID_MARKER_CHECK');
  return { type, id, params };
}
function hasMarkerPrefix(text) {
  return text.length >= 34 && text[0] === '[' && text[33] === '/' &&
    /^[0-9a-f]{32}$/.test(text.slice(1, 33));
}
export class SecretMarkerDecoder {
  constructor({ redaction_format, redaction_scope } = {}) {
    if (redaction_format !== FORMAT) throw new Error('UNSUPPORTED_REDACTION_FORMAT');
    if (typeof redaction_scope !== 'string' ||
        !/^[0-9a-f]{32}$/.test(redaction_scope)) throw new Error('INVALID_REDACTION_SCOPE');
    this.scope = redaction_scope;
    this.cache = new Map();
    this.reverse = new Map();
    this.pending = '';
    this.invalidated = false;
  }
  decodeMarker(marker) {
    if (this.invalidated) throw new Error('DECODER_INVALIDATED');
    const { type, id, params } = parseMarker(marker);
    const parts = [FORMAT, this.scope, type, id, params ?? ''];
    const key = parts.map(s => Buffer.byteLength(s) + ':' + s).join('');
    if (this.cache.has(key)) return this.cache.get(key);
    const seed = hash(Buffer.concat([SYNTH, Buffer.from(key)]));
    const value = reconstruct(type, params, seed);
    if (!verifyReplacement(type, params, value)) throw new Error('INVALID_SYNTHETIC_SHAPE');
    const reverse = type + ':' + value;
    if (this.reverse.has(reverse) && this.reverse.get(reverse) !== key) {
      this.invalidated = true;
      this.cache.clear();
      this.reverse.clear();
      throw new Error('SYNTHETIC_COLLISION');
    }
    this.cache.set(key, value);
    this.reverse.set(reverse, key);
    return value;
  }
  feed(chunk, final = false) {
    if (this.invalidated) throw new Error('DECODER_INVALIDATED');
    if (typeof chunk !== 'string') throw new TypeError('TEXT_CHUNK_REQUIRED');
    const output = [];
    for (const char of chunk) {
      if (this.pending === '') {
        if (char === '[') this.pending = '[';
        else output.push(char);
        continue;
      }
      if (char === '[') {
        output.push(this.pending);
        this.pending = '[';
        continue;
      }
      this.pending += char;
      if (char === ']') {
        const candidate = this.pending;
        this.pending = '';
        if (hasMarkerPrefix(candidate)) {
          if (candidate.length > MAX_MARKER) {
            this.invalidated = true;
            throw new Error('MARKER_TOO_LONG');
          }
          output.push(this.decodeMarker(candidate));
        } else {
          output.push(candidate);
        }
      } else if (this.pending.length > MAX_MARKER) {
        if (hasMarkerPrefix(this.pending)) {
          this.invalidated = true;
          throw new Error('MARKER_TOO_LONG');
        }
        output.push(this.pending);
        this.pending = '';
      }
    }
    if (final && this.pending) {
      if (hasMarkerPrefix(this.pending)) {
        this.invalidated = true;
        throw new Error('TRUNCATED_MARKER');
      }
      output.push(this.pending);
      this.pending = '';
    }
    return output.join('');
  }
  finish() { return this.feed('', true); }
}
export function decodeText(text, metadata) {
  return new SecretMarkerDecoder(metadata).feed(text, true);
}
export { width as measureLogicalLength };
