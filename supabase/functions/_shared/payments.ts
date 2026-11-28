// Shared helpers for payment functions. Secrets live in Supabase, never in the website.
import { createClient as sbClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = () => sbClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const configured = () =>
  !!(Deno.env.get("MONIME_SPACE_ID") && Deno.env.get("MONIME_ACCESS_TOKEN") && Deno.env.get("SITE_URL"));
// Direct calls to the Monime REST API (no third-party SDK). Docs: docs.monime.io, version caph.2025-08-23.
// Responses look like { success, messages, result }; we return { success, data } so callers stay simple.
const MONIME_API = Deno.env.get("MONIME_API_URL") || "https://api.monime.io";
async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("MONIME_ACCESS_TOKEN")}`,
    "Monime-Space-Id": Deno.env.get("MONIME_SPACE_ID")!,
    "Monime-Version": "caph.2025-08-23",
    "Content-Type": "application/json",
  };
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  try {
    const res = await fetch(MONIME_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) console.error("Monime error", res.status, JSON.stringify(j).slice(0, 300));
    return { success: res.ok && j.success !== false, data: j.result ?? null };
  } catch (e) {
    console.error("Monime request failed", String(e));
    return { success: false, data: null };
  }
}
export const monime = () => ({
  checkoutSession: {
    create: (b: { name: string; amount: number; quantity: number; successUrl: string; cancelUrl: string; description: string }) =>
      call("POST", "/v1/checkout-sessions", {
        name: b.name, description: b.description, successUrl: b.successUrl, cancelUrl: b.cancelUrl,
        lineItems: [{ name: b.name, quantity: b.quantity, price: { currency: "SLE", value: b.amount } }],
      }),
    retrieve: (id: string) => call("GET", `/v1/checkout-sessions/${encodeURIComponent(id)}`),
  },
  // USSD payment codes: the player dials the code on their phone and approves with their PIN.
  paymentCode: {
    create: (b: { name: string; amount: number; provider: string; reference: string; duration: string }) =>
      call("POST", "/v1/payment-codes", {
        name: b.name, mode: "one_time", enable: true, duration: b.duration, reference: b.reference,
        amount: { currency: "SLE", value: b.amount }, authorizedProviders: [b.provider],
      }),
    retrieve: (id: string) => call("GET", `/v1/payment-codes/${encodeURIComponent(id)}`),
  },
});

export async function userId(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data } = await admin().auth.getUser(token);
  return data?.user?.id ?? null;
}

// CONFIRM these status words against a real test payment and Monime's docs.
const PAID = ["completed", "paid", "succeeded", "success", "successful"];
const DEAD = ["expired", "failed", "cancelled", "canceled"];

// Never trust the browser or the webhook body: ask Monime directly for the session status.
export async function verify(row: any): Promise<string> {
  if (!row.provider_session_id) return row.status;
  const isCode = String(row.provider_session_id).startsWith("pmc-");
  const r = isCode
    ? await monime().paymentCode.retrieve(row.provider_session_id)
    : await monime().checkoutSession.retrieve(row.provider_session_id);
  if (!r.success) return row.status;
  const st = String(r.data?.status ?? "").toLowerCase();
  const sb = admin();
  if (PAID.includes(st)) {
    const li: any = r.data?.lineItems?.data?.[0];
    const paidMinor = isCode
      ? (r.data?.amount?.value != null ? Number(r.data.amount.value) : null)
      : (li ? Number(li.price?.value) * Number(li.quantity ?? 1) : null);
    if (paidMinor !== null && paidMinor !== Math.round(Number(row.amount) * 100)) {
      await sb.from("payments").update({ note: "Amount mismatch: review manually" }).eq("id", row.id);
      return row.status;
    }
    await sb.rpc("finalize_payment", { p_id: row.id });
    return "successful";
  }
  if (DEAD.includes(st)) {
    await sb.from("payments").update({ status: "failed" }).eq("id", row.id).eq("status", "pending");
    return "failed";
  }
  return "pending";
}
