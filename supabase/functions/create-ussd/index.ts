import { admin, configured, cors, json, monime, userId } from "../_shared/payments.ts";

// Starts a USSD payment: the player picks Orange Money or Afrimoney, we create a one-time
// Monime payment code and return the dial string. The amount always comes from the database.
const PROVIDERS = ["m17", "m18"]; // m17 = Orange Money SL, m18 = Afrimoney SL (check in your Monime dashboard)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!configured()) return json({ error: "Payments are not enabled yet." }, 503);
  const uid = await userId(req);
  if (!uid) return json({ error: "Please log in first." }, 401);
  const { tournament_id, provider } = await req.json().catch(() => ({}));
  if (!PROVIDERS.includes(provider)) return json({ error: "Please choose Orange Money or Afrimoney." }, 400);
  const sb = admin();

  const { data: prof } = await sb.from("profiles").select("suspended").eq("id", uid).maybeSingle();
  if (!prof || prof.suspended) return json({ error: "Your account cannot join tournaments right now." }, 403);

  const { data: t } = await sb.from("tournaments").select("*").eq("id", tournament_id).single();
  if (!t || t.status !== "open" || new Date(t.register_by) < new Date()) return json({ error: "Registration is closed." }, 400);
  if (!(Number(t.entry_fee) > 0) || t.currency !== "SLE") return json({ error: "This tournament does not need an SLE payment." }, 400);
  const { data: already } = await sb.from("participants").select("user_id")
    .eq("tournament_id", t.id).eq("user_id", uid).eq("status", "registered").maybeSingle();
  if (already) return json({ error: "You are already registered." }, 400);
  const { count } = await sb.from("participants").select("*", { count: "exact", head: true })
    .eq("tournament_id", t.id).eq("status", "registered");
  if ((count ?? 0) >= t.max_participants) return json({ error: "This tournament is full." }, 400);

  const { data: p, error: pe } = await sb.from("payments")
    .insert({ user_id: uid, tournament_id: t.id, purpose: "tournament_entry", amount: t.entry_fee, currency: "SLE" })
    .select().single();
  if (pe) return json({ error: "Could not start the payment. Please try again." }, 500);

  const r = await monime().paymentCode.create({
    name: `Entry: ${t.name}`.slice(0, 64).padEnd(3, " "),
    amount: Math.round(Number(t.entry_fee) * 100), // minor units, same as checkout
    provider,
    reference: p.id,
    duration: "15m",
  });
  if (!r.success || !r.data?.ussdCode) {
    await sb.from("payments").update({ status: "failed", note: "ussd code create failed" }).eq("id", p.id);
    return json({ error: "The payment provider is not responding. Please try again." }, 502);
  }
  await sb.from("payments").update({ provider_session_id: r.data.id }).eq("id", p.id);
  return json({ payment_id: p.id, ussd: r.data.ussdCode, expires_at: r.data.expireTime ?? null });
});
