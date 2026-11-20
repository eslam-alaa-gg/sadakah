/* Service Worker — صدقة جارية
 * - يخزّن ملفات الواجهة الأساسية للعمل دون اتصال.
 * - لا يتدخل في: واجهة الزوار /api/ ، ملفات الصوت وطلبات Range (يتولاها المتصفح مباشرة).
 * - الصفحة: النسخة المخزنة فورًا لسرعة الفتح، مع تحديثها من الشبكة في الخلفية.
 * - باقي الملفات: من التخزين فورًا مع تحديثها في الخلفية (stale-while-revalidate).
 * عند تغيير أي ملف ثابت ارفع رقم الإصدار في CACHE_NAME.
 */
const CACHE_NAME = 'al-jallad-pwa-v27';
const CORE = ['./', './index.html', './manifest.webmanifest'];
const OPTIONAL = [
  './visitors-local.js',
  './data/hadith.json',
  './assets/audio/quran/metadata.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    // ملف اختياري مفقود لا يجب أن يُفشل تثبيت الـ Service Worker كله
    await Promise.all(OPTIONAL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // واجهة الزوار والـ API: لا تُخزَّن أبدًا
  if (url.pathname.includes('/api/')) return;
  // الصوت وطلبات Range: يتعامل معها المتصفح مباشرة (الاستجابات الجزئية 206 لا يمكن تخزينها)
  if (request.headers.has('range') || /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // Always fetch the real HTML entry point; never treat XML or another
      // successful response as the cached homepage.
      const indexUrl = new URL('./index.html', self.location.href).href;
      const cache = await caches.open(CACHE_NAME);
      let cached = await cache.match(indexUrl);

      if (cached && !(cached.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
        await cache.delete(indexUrl);
        cached = null;
      }

      try {
        const response = await fetch(new Request(indexUrl, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }));
        const contentType = (response.headers.get('content-type') || '').toLowerCase();

        if (response.ok && contentType.includes('text/html')) {
          await cache.put(indexUrl, response.clone());
          return response;
        }

        if (cached) return cached;
        return Response.error();
      } catch (err) {
        if (cached) return cached;
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response && response.ok && response.status === 200) cache.put(request, response.clone());
      return response;
    });
    if (cached) { network.catch(() => {}); return cached; }
    return network;
  })());
});
