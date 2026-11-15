const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const VID_OK = /^[A-Za-z0-9_-]{8,64}$/;
const ONLINE_MS = 60 * 1000;
const VISIT_TTL = 30 * 60;

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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const action = q.get('action');
    const vid = q.get('vid') || '';
    if (!['hit', 'ping', 'leave'].includes(action) || !VID_OK.test(vid)) {
      return send(res, 400, { error: 'bad request' });
    }
    if (!URL_ || !TOKEN) return send(res, 500, { error: 'database not connected' });

    const now = Date.now();
    const visitKey = 'sj:v:' + vid;

    if (action === 'leave') {
      await redis([['ZREM', 'sj:online', vid]]);
      return send(res, 200, { ok: true });
    }

    const first = [
      action === 'hit'
        ? ['SET', visitKey, '1', 'NX', 'EX', String(VISIT_TTL)]
        : ['SET', visitKey, '1', 'EX', String(VISIT_TTL)],
      ['ZADD', 'sj:online', String(now), vid],
      ['ZREMRANGEBYSCORE', 'sj:online', '-inf', String(now - ONLINE_MS)],
      ['ZCARD', 'sj:online'],
    ];
    const [setRes, , , online] = await redis(first);

    const isNewVisit = action === 'hit' && setRes === 'OK';
    const [count] = await redis([[isNewVisit ? 'INCR' : 'GET', 'sj:count']]);

    return send(res, 200, { count: Number(count) || 0, online: Number(online) || 0 });
  } catch (e) {
    return send(res, 500, { error: 'server error' });
  }
};
