import { getStore } from "@netlify/blobs";
import { APP_HTML, APP_VERSION } from "../lib/app-html.mjs";

const DEFAULT_MAX_DEVICES = 3;

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const normalize = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad_request" }, 400);
  }

  const code = normalize(body.code);
  const device = String(body.device || "").slice(0, 64);
  const verifyOnly = body.mode === "verify";
  if (code.length !== 16 || !device) return reply({ error: "invalid" }, 400);

  const store = getStore({ name: "licenses", consistency: "strong" });
  const rec = await store.get(code, { type: "json" });
  if (!rec) return reply({ error: "invalid" }, 403);
  if (rec.revoked) return reply({ error: "revoked" }, 403);

  const devices = Array.isArray(rec.devices) ? rec.devices : [];
  if (!devices.includes(device)) {
    // التحقق الخلفي لا يسجّل أجهزة جديدة: الجهاز غير المعروف عليه التفعيل من جديد
    if (verifyOnly) return reply({ error: "reset" }, 403);
    if (devices.length >= (rec.maxDevices || DEFAULT_MAX_DEVICES)) {
      return reply({ error: "limit" }, 403);
    }
    devices.push(device);
    rec.devices = devices;
    rec.activatedAt = rec.activatedAt || new Date().toISOString();
    await store.setJSON(code, rec);
  }

  if (verifyOnly) return reply({ ok: true, version: APP_VERSION });
  return reply({ ok: true, version: APP_VERSION, html: APP_HTML });
};

export const config = { path: "/api/unlock" };
