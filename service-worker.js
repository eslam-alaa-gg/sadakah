/* Service Worker — صدقة جارية
 * - يخزّن ملفات الواجهة الأساسية للعمل دون اتصال.
 * - لا يتدخل في: واجهة الزوار /api/ ، ملفات الصوت وطلبات Range (يتولاها المتصفح مباشرة).
 * - الصفحة: النسخة المخزنة فورًا لسرعة الفتح، مع تحديثها من الشبكة في الخلفية.
 * - باقي الملفات: من التخزين فورًا مع تحديثها في الخلفية (stale-while-revalidate).
 * عند تغيير أي ملف ثابت ارفع رقم الإصدار في CACHE_NAME.
 */
const CACHE_NAME = 'al-jallad-pwa-v28';
const CORE = ['./index.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(new Request(new URL('./index.html', self.location.href), {
      cache: 'no-store',
      credentials: 'same-origin'
    }));
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (response.ok && type.includes('text/html')) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(new URL('./index.html', self.location.href), response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Remove every previous cache created for this origin.
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
  // APIs and audio/range requests must always be handled directly.
  if (url.pathname.includes('/api/')) return;
  if (request.headers.has('range') || /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const indexUrl = new URL('./index.html', self.location.href);
      try {
        const response = await fetch(new Request(indexUrl, {
          cache: 'no-store',
          credentials: 'same-origin'
        }));
        const type = (response.headers.get('content-type') || '').toLowerCase();
        if (response.ok && type.includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(indexUrl, response.clone());
          return response;
        }
        throw new Error('The server did not return an HTML page.');
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(indexUrl);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Network only: do not serve stale JS, CSS, images, JSON, or manifests.
  event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
});
