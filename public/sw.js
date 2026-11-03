/* غيّر رقم النسخة عند كل تحديث لملفات المنتج */
const CACHE = "budget-v3";
const CORE = ["./", "index.html", "manifest.json", "vendor/chart.umd.min.js", "vendor/xlsx.full.min.js", "vendor/tajawal.css"];
const OPTIONAL = ["icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE); /* الأساسيات: إن فشل شيء منها يفشل التثبيت ليُعاد المحاولة */
    for (const u of OPTIONAL) { try { await c.add(u); } catch (_) {} } /* الأيقونات: لا تُفشل التثبيت */
    try { /* ملفات خط Tajawal المذكورة داخل ملف CSS */
      const base = new URL("vendor/tajawal.css", self.location).href;
      const css = await (await fetch(base)).text();
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => new URL(m[1].replace(/['"]/g, ""), base).href);
      await c.addAll([...new Set(urls)]);
    } catch (_) {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); /* يحذف النسخة القديمة غير المحمية */
    await self.clients.claim();
  })());
});

/* صفحة الدخول فقط: الشبكة أولاً مع مهلة 4 ثوانٍ، ثم النسخة المحفوظة (لا تعلق الشاشة عند ضعف الاتصال) */
function networkFirst(req) {
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match("index.html").then((r) => r || caches.match("./")).then((r) => r || Response.error());
    const t = setTimeout(() => { if (!done) { done = true; fallback().then((r) => resolve(r.type === "error" ? fetch(req) : r)); } }, 4000);
    fetch(req).then((res) => {
      clearTimeout(t);
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", cp)); }
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(t);
      if (!done) { done = true; fallback().then(resolve); }
    });
  });
}

/* الصفحة الرئيسية هي صفحة إدخال الكود، وهي الوحيدة التي تُخزَّن كصفحة */
function isGatePage(url) { return url.pathname === "/" || url.pathname === "/index.html"; }

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; /* طلب التفعيل (POST) لا يمر من هنا */
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; /* لا تخزين لأي طلب على /api/ */
  if (req.mode === "navigate") {
    if (url.origin === location.origin && isGatePage(url)) e.respondWith(networkFirst(req));
    return; /* بقية الصفحات (مثل admin.html) يتعامل معها المتصفح مباشرة بلا تخزين */
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && url.origin === location.origin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return res;
  })));
});
