const crypto = require('crypto');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestHash(value) {
  return sha256(canonicalize(value));
}

function validateOperationalSecret(secret, label = 'Secret') {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw Object.assign(new Error(`${label} is missing or too short`), { code: 'CONFIG_SECRET_INVALID', status: 503 });
  }
  if (/(?:replace[-_ ]?with|change[-_ ]?me|changeme|example[-_ ]?secret|default[-_ ]?secret)/i.test(secret)) {
    throw Object.assign(new Error(`${label} is still a placeholder`), { code: 'CONFIG_SECRET_PLACEHOLDER', status: 503 });
  }
  return secret;
}

function signWebhook(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function verifyWebhook({ secret, timestamp, signature, rawBody, nowMs = Date.now(), toleranceSeconds = 300 }) {
  try {
    validateOperationalSecret(secret, 'Provider signing secret');
  } catch (error) {
    error.code = 'PROVIDER_SECRET_INVALID';
    throw error;
  }
  if (!/^\d{10}$/.test(String(timestamp || ''))) throw Object.assign(new Error('Provider timestamp is invalid'), { code: 'WEBHOOK_TIMESTAMP_INVALID', status: 401 });
  const age = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
  if (age > toleranceSeconds) throw Object.assign(new Error('Provider webhook is outside the replay window'), { code: 'WEBHOOK_REPLAY_WINDOW', status: 401 });
  if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) throw Object.assign(new Error('Provider signature is invalid'), { code: 'WEBHOOK_SIGNATURE_INVALID', status: 401 });
  const expected = signWebhook(secret, timestamp, rawBody);
  const valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  if (!valid) throw Object.assign(new Error('Provider signature is invalid'), { code: 'WEBHOOK_SIGNATURE_INVALID', status: 401 });
  return true;
}

function validateProviderHost(host) {
  if (typeof host !== 'string' || host.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) {
    throw Object.assign(new Error('A valid provider DNS host is required'), { code: 'PROVIDER_HOST_INVALID' });
  }
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    throw Object.assign(new Error('Private provider hosts are forbidden'), { code: 'PROVIDER_HOST_PRIVATE' });
  }
  return normalized;
}

module.exports = { canonicalize, requestHash, sha256, signWebhook, validateOperationalSecret, validateProviderHost, verifyWebhook };
