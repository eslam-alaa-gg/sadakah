/* ============================================================
 * visitors-local.js — ضبط عدّاد الزوار والمتصلين
 * ضع هذا الملف بجانب index.html في GitHub (نفس المجلد).
 * عدّل الرقمين أدناه فقط.
 * ============================================================ */
(function () {
  var VISITORS_START = 73; // الزيارات تبدأ من هذا الرقم ثم تزيد فعليًا
  var ONLINE_START   = 0;  // 0 = المتصلون الحقيقيون فقط (غيّره لو أردت رقمًا ابتدائيًا)

  /* الخلفية الحقيقية (إن وُجدت): يُضاف الرقمان إلى أرقامها.
   * على GitHub Pages لا توجد خلفية، فيُعرض الرقمان كما هما. */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var realBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  if (!realFetch) return;

  function apiUrl() {
    var m = document.querySelector('meta[name=visitors-api]');
    return (m && m.content) || '/api/visitors';
  }
  function isApi(u) {
    try {
      var a = new URL(u, location.href), b = new URL(apiUrl(), location.href);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (e) { return false; }
  }
  // على github.io لا يوجد /api أصلًا، فلا نرسل الطلب (تفاديًا لأخطاء 404)
  function noBackend() {
    try {
      var b = new URL(apiUrl(), location.href);
      return /\.github\.io$/i.test(b.hostname) && b.origin === location.origin;
    } catch (e) { return false; }
  }
  function reply(count, online) {
    return new Response(JSON.stringify({ count: count, online: online }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isApi(url)) return realFetch(input, init);
    if (noBackend()) return Promise.resolve(reply(VISITORS_START, ONLINE_START));
    return realFetch(input, init)
      .then(function (r) { if (!r.ok) throw new Error('api'); return r.json(); })
      .then(function (d) {
        if (typeof d.count !== 'number') throw new Error('bad');
        return reply(d.count + VISITORS_START,
                     (typeof d.online === 'number' ? d.online : 0) + ONLINE_START);
      })
      .catch(function () { return reply(VISITORS_START, ONLINE_START); });
  };

  if (realBeacon) {
    navigator.sendBeacon = function (u, d) {
      return noBackend() && isApi(u) ? true : realBeacon(u, d);
    };
  }
})();
