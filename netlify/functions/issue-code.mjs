import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const normalize = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function authorized(req) {
  const secret = process.env.LICENSE_ISSUE_SECRET || "";
  const sent = req.headers.get("x-license-issue-secret") || "";
  const a = Buffer.from(secret);
  const b = Buffer.from(sent);
  return secret.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
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

  const orderId = String(body.orderId || body.order_id || "").trim().slice(0, 160);
  const email = String(body.email || body.customerEmail || body.customer_email || "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  if (!orderId || !email) return reply({ error: "missing_order_or_email" }, 400);

  const store = getStore({ name: "licenses", consistency: "strong" });
  const reservationKey = `reservation:${orderId}`;
  const existing = await store.get(reservationKey, { type: "json" });
  if (existing?.code) return reply({ ok: true, code: existing.code, reused: true });

  const keys = [];
  for await (const page of store.list({ paginate: true })) {
    for (const blob of page.blobs) keys.push(blob.key);
  }

  for (const key of keys) {
    if (key.startsWith("reservation:")) continue;
    const record = await store.get(key, { type: "json" });
    if (!record || record.revoked || record.orderId || record.assignedTo) continue;

    record.orderId = orderId;
    record.assignedTo = email;
    record.issuedAt = new Date().toISOString();
    await store.setJSON(key, record);
    const code = key.match(/.{4}/g).join("-");
    await store.setJSON(reservationKey, { code, orderId, email, issuedAt: record.issuedAt });
    return reply({ ok: true, code, reused: false });
  }

  return reply({ error: "no_available_code" }, 409);
};

export const config = { path: "/api/issue-code" };
