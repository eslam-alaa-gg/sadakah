const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'sj:tasbeeh:total';

// حد بسيط لكل IP لحماية العدّاد من التضخيم الآلي
const RATE_LIMIT = 20;
const RATE_WINDOW_S = 60;

async function redis(commands) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify(obj));
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// يرفض الطلبات القادمة من نطاقات أخرى (المتصفح يرسل Origin دائمًا مع POST)
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === String(host).split(',')[0].trim();
  } catch (e) {
    return false;
  }
}

async function isRateLimited(ip) {
  const key = 'sj:rl:tasbeeh:' + ip;
  const [count] = await redis([['INCR', key]]);
  const n = Number(count) || 0;
  if (n === 1) await redis([['EXPIRE', key, String(RATE_WINDOW_S)]]);
  return n > RATE_LIMIT;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return send(res, 405, { ok: false, error: 'method not allowed' });
  }
  if (!isSameOrigin(req)) return send(res, 403, { ok: false, error: 'forbidden' });
  try {
    if (!URL_ || !TOKEN) return send(res, 500, { ok: false, error: 'database not connected' });
    if (await isRateLimited(clientIp(req))) {
      res.setHeader('Retry-After', String(RATE_WINDOW_S));
      return send(res, 429, { ok: false, error: 'too many requests' });
    }
    const result = await redis([[req.method === 'POST' ? 'INCR' : 'GET', KEY]]);
    return send(res, 200, { ok: true, total: Number(result[0]) || 0 });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'server error' });
  }
};
