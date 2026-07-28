// sw.js — Service Worker for PWA
const CACHE_NAME = 'cycling-ai-v1';
const ASSETS = [
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/voice.js',
  '/js/sensor.js',
  '/js/ai-coach.js',
  '/js/map.js',
  '/js/app.js',
  '/manifest.json',
];

// 安装：缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 高德地图 API 和其他外部资源不缓存
  if (url.hostname.includes('amap.com') ||
      url.hostname.includes('gaode.com') ||
      url.hostname.includes('api.openai.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 只缓存成功的 GET 请求
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      // 离线回退
      if (event.request.destination === 'document') {
        return caches.match('/index.html');
      }
    })
  );
});

// 后台保活消息
self.addEventListener('message', (event) => {
  if (event.data === 'keepalive') {
    // 向所有客户端发送保活确认
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage('keepalive-ok'));
    });
  }
});
