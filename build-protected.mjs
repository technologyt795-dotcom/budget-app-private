// يحوّل protected/app.html إلى وحدة داخل الدالة، فلا يُنشر الملف علناً أبداً.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

if (!existsSync("protected/app.html")) {
  console.error("الملف protected/app.html غير موجود. ضع ملف التطبيق الكامل (index.html القديم) هناك باسم app.html");
  process.exit(1);
}
const html = readFileSync("protected/app.html", "utf8");
const version = createHash("sha256").update(html).digest("hex").slice(0, 12);
mkdirSync("netlify/lib", { recursive: true });
writeFileSync(
  "netlify/lib/app-html.mjs",
  `export const APP_HTML = ${JSON.stringify(html)};\nexport const APP_VERSION = ${JSON.stringify(version)};\n`
);
console.log("protected app ready:", version, html.length, "chars");
