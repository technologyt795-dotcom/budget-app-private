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
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));
async function sendLicenseEmail({ email, code, orderId }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.LICENSE_FROM_EMAIL || "";
  const fromName = process.env.LICENSE_FROM_NAME || "إدارة ميزانيتي";
  if (!apiKey || !from) return { ok: false, reason: "email_not_configured" };
  const safeCode = escapeHtml(code);
  const safeOrderId = escapeHtml(orderId);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to: [email],
      subject: "كود تفعيل إدارة ميزانيتي",
      text: `مرحبًا،\n\nشكرًا لشرائك. كود التفعيل الخاص بك هو:\n\n${code}\n\nرقم الطلب: ${orderId}\n\nأدخل الكود في صفحة التفعيل.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8"><h2>كود تفعيل إدارة ميزانيتي</h2><p>مرحبًا،</p><p>شكرًا لشرائك. كود التفعيل الخاص بك هو:</p><p style="font-size:24px;font-weight:bold;letter-spacing:2px;direction:ltr;text-align:center">${safeCode}</p><p>رقم الطلب: ${safeOrderId}</p><p>أدخل الكود في صفحة التفعيل.</p></div>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Resend email failed", response.status, detail.slice(0, 500));
    return { ok: false, reason: "email_provider_error" };
  }
  return { ok: true };
}
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
  if (existing?.code) {
    if (existing.email !== email) return reply({ error: "order_email_mismatch" }, 409);
    if (!existing.emailSentAt) {
      const sent = await sendLicenseEmail({ email, code: existing.code, orderId });
      if (!sent.ok) return reply({ error: sent.reason }, 502);
      existing.emailSentAt = new Date().toISOString();
      await store.setJSON(reservationKey, existing);
    }
    return reply({ ok: true, code: existing.code, reused: true, emailed: true });
  }
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
    const reservation = { code, orderId, email, issuedAt: record.issuedAt };
    await store.setJSON(reservationKey, reservation);
    const sent = await sendLicenseEmail({ email, code, orderId });
    if (!sent.ok) return reply({ error: sent.reason }, 502);
    reservation.emailSentAt = new Date().toISOString();
    await store.setJSON(reservationKey, reservation);
    return reply({ ok: true, code, reused: false, emailed: true });
  }
  return reply({ error: "no_available_code" }, 409);
};
export const config = { path: "/api/issue-code" };
