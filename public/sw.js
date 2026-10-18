const CACHE_NAME = 'seereen-staff-v6';
const ASSETS_TO_CACHE = [
  '/',
  '/images/logo.jpg',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

// Install event: Pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate event: Cleanup older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: Network first, fallback to cache for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip API, socket.io, and uploads requests from caching
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Push Notification Event: Receive background push notifications when screen is locked or app is closed
self.addEventListener('push', (event) => {
  let data = {
    title: 'ستافی سیرین 🌸',
    body: 'ئاگادارییەکی نوێ هەیە',
    icon: '/images/logo.jpg',
    badge: '/images/logo.jpg',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/images/logo.jpg',
    badge: data.badge || '/images/logo.jpg',
    image: data.image || null,
    vibrate: [300, 100, 400, 100, 300],
    data: data.data || { url: '/' },
    tag: data.tag || ('seereen-' + Date.now()),
    renotify: true,
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event: Focus open window or open new window to specific page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) 
    ? event.notification.data.url 
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          if ('navigate' in client && targetUrl !== '/') {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
