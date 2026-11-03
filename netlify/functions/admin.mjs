import { getStore } from "@netlify/blobs";
import { randomInt, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون أحرف متشابهة (O/0, I/1)

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const normalize = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const pretty = (c) => c.match(/.{4}/g).join("-");
const clamp = (v, min, max, def) => Math.min(Math.max(parseInt(v, 10) || def, min), max);

function authorized(req) {
  const key = process.env.ADMIN_KEY || "";
  const sent = req.headers.get("x-admin-key") || "";
  const a = Buffer.from(key);
  const b = Buffer.from(sent);
  return key.length >= 12 && a.length === b.length && timingSafeEqual(a, b);
}

function newCode() {
  let s = "";
  for (let i = 0; i < 16; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "method" }, 405);
  if (!authorized(req)) return reply({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad_request" }, 400);
  }

  const store = getStore({ name: "licenses", consistency: "strong" });
  const action = body.action;

  if (action === "create") {
    const count = clamp(body.count, 1, 200, 1);
    const maxDevices = clamp(body.maxDevices, 1, 10, 3);
    const note = String(body.note || "").slice(0, 80);
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = newCode();
      await store.setJSON(code, {
        createdAt: new Date().toISOString(),
        note,
        maxDevices,
        devices: [],
        revoked: false,
      });
      codes.push(pretty(code));
    }
    return reply({ ok: true, codes });
  }

  if (action === "list") {
    const keys = [];
    for await (const page of store.list({ paginate: true })) {
      for (const b of page.blobs) keys.push(b.key);
    }
    const items = [];
    for (let i = 0; i < keys.length; i += 20) {
      const chunk = await Promise.all(
        keys.slice(i, i + 20).map(async (k) => {
          const r = (await store.get(k, { type: "json" })) || {};
          return {
            code: pretty(k),
            note: r.note || "",
            devices: (r.devices || []).length,
            maxDevices: r.maxDevices || 3,
            revoked: !!r.revoked,
            createdAt: r.createdAt || "",
          };
        })
      );
      items.push(...chunk);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return reply({ ok: true, items });
  }

  const code = normalize(body.code);
  const rec = code.length === 16 ? await store.get(code, { type: "json" }) : null;
  if (!rec) return reply({ error: "not_found" }, 404);

  if (action === "revoke") rec.revoked = true;
  else if (action === "restore") rec.revoked = false;
  else if (action === "reset") rec.devices = [];
  else return reply({ error: "unknown_action" }, 400);

  await store.setJSON(code, rec);
  return reply({ ok: true });
};

export const config = { path: "/api/admin" };
