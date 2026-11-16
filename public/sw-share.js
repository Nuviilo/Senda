// Handles Android Web Share Target POST requests when Senda is installed as a PWA / TWA APK.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll('files');
          const cache = await caches.open('senda-share-target-v1');
          const manifest = [];
          let idx = 0;
          for (const item of files) {
            if (item && typeof item === 'object' && 'arrayBuffer' in item) {
              const key = `/__shared_file_${Date.now()}_${idx++}`;
              const buf = await item.arrayBuffer();
              await cache.put(
                key,
                new Response(buf, {
                  headers: {
                    'Content-Type': item.type || 'application/octet-stream',
                    'X-Senda-Filename': encodeURIComponent(item.name || `shared-file-${idx}`),
                    'X-Senda-Size': String(item.size || buf.byteLength),
                  },
                })
              );
              manifest.push(key);
            }
          }
          await cache.put(
            '/__shared_manifest__',
            new Response(JSON.stringify(manifest), {
              headers: { 'Content-Type': 'application/json' },
            })
          );
        } catch (err) {
          console.error('Share target handler error:', err);
        }
        return Response.redirect('/?tab=send&shared=1', 303);
      })()
    );
  }
});
