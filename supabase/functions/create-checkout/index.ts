import { admin, configured, cors, json, monime, userId } from "../_shared/payments.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!configured()) return json({ error: "Payments are not enabled yet." }, 503);
  const uid = await userId(req);
  if (!uid) return json({ error: "Login required" }, 401);
  const { tournament_id } = await req.json().catch(() => ({}));
  const sb = admin();

  const { data: t } = await sb.from("tournaments").select("*").eq("id", tournament_id).single();
  if (!t || t.status !== "open" || new Date(t.register_by) < new Date()) return json({ error: "Registration closed" }, 400);
  if (!(Number(t.entry_fee) > 0) || t.currency !== "SLE") return json({ error: "No SLE payment required" }, 400);
  const { data: already } = await sb.from("participants").select("user_id")
    .eq("tournament_id", t.id).eq("user_id", uid).eq("status", "registered").maybeSingle();
  if (already) return json({ error: "Already registered" }, 400);
  const { count } = await sb.from("participants").select("*", { count: "exact", head: true })
    .eq("tournament_id", t.id).eq("status", "registered");
  if ((count ?? 0) >= t.max_participants) return json({ error: "Tournament is full" }, 400);

  // Amount always comes from the database, never from the browser.
  const { data: p, error: pe } = await sb.from("payments")
    .insert({ user_id: uid, tournament_id: t.id, purpose: "tournament_entry", amount: t.entry_fee, currency: "SLE" })
    .select().single();
  if (pe) return json({ error: "Could not start payment" }, 500);

  const site = Deno.env.get("SITE_URL")!;
  const r = await monime().checkoutSession.create({
    name: `Entry: ${t.name}`.slice(0, 60),
    amount: Math.round(Number(t.entry_fee) * 100), // minor units: confirm with a small test payment
    quantity: 1,
    successUrl: `${site}/#/pay`,
    cancelUrl: `${site}/#/t/${t.id}`,
    description: "GAME BOI tournament entry fee",
  });
  if (!r.success || !r.data?.redirectUrl) {
    await sb.from("payments").update({ status: "failed", note: "checkout create failed" }).eq("id", p.id);
    return json({ error: "Payment provider error" }, 502);
  }
  await sb.from("payments").update({ provider_session_id: r.data.id, provider_order: r.data.orderNumber }).eq("id", p.id);
  return json({ url: r.data.redirectUrl });
});
