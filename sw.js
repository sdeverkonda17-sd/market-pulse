const CACHE='market-pulse-v39.25';const ASSETS=['./','./index.html','./styles.css?v=39.25','./config.js?v=39.25','./app.js?v=39.25','./manifest.webmanifest','./icon.svg'];self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method==='GET'&&url.origin===location.origin&&!url.pathname.startsWith('/api/'))event.respondWith(fetch(event.request).then(response=>{caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));return response}).catch(()=>caches.match(event.request)));});
















