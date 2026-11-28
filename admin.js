/* GAME BOI v9: admin dashboard. Loads after v8.js. Needs supabase_schema_v9_admin.sql (run once in Supabase).
   Tabs: Overview, Payments, Refunds, Tournaments, Users, Reports, Messages, Activity.
   No money moves from here. A refund is approved, then the admin sends the money back (Monime dashboard or
   mobile money) and records the reference. Every admin action is also checked on the server (is_admin()). */
(function () {
  "use strict";
  if (typeof views === "undefined" || typeof sb === "undefined" || !sb) return;

  const say = m => { try { window.GBfx && GBfx.toast ? GBfx.toast(m) : alert(m); } catch (e) { alert(m); } };
  const missing = e => e && /relation|does not exist|schema cache|function/i.test(e.message || "");
  const SETUP = `<div class="msg">This part needs <b>supabase_schema_v9_admin.sql</b> to be run once in Supabase (SQL Editor).</div>`;
  const sle = n => Number(n || 0).toLocaleString() + " SLE";
  const when = d => d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "–";
  const dayLabel = d => new Date(d + "T00:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
  const PILL = { successful: "s-open", approved: "s-open", refunded: "s-open", open: "s-open", failed: "s-live", rejected: "s-live", cancelled: "s-live", live: "s-live" };
  const pill = s => `<span class="pill ${PILL[s] || ""}">${esc(s)}</span>`;
  const isOpenRefund = r => r.status === "requested" || r.status === "approved";
  let lastStats = null, payRows = [];

  const TABS = [["", "Overview"], ["payments", "Payments"], ["refunds", "Refunds"], ["tournaments", "Tournaments"],
    ["users", "Users"], ["reports", "Reports"], ["messages", "Messages"], ["activity", "Activity"]];

  function head(cur, st) {
    const n = k => Number(st && st[k]) || 0;
    const badge = { refunds: n("refunds_requested") + n("refunds_approved"), reports: n("reports_open") + n("disputes_open"), payments: n("needs_refund") };
    return `<h1>Admin</h1><nav class="adm-tabs" aria-label="Admin sections">${TABS.map(([k, t]) =>
      `<a href="#/admin${k ? "/" + k : ""}" class="${k === cur ? "on" : ""}"${k === cur ? ' aria-current="page"' : ""}>${esc(t)}${badge[k] ? `<b>${badge[k]}</b>` : ""}</a>`).join("")}</nav>`;
  }

  /* ---------- Overview ---------- */
  function chart(rows) {
    const r = rows || [], peak = Math.max(0, ...r.map(x => Number(x.total))), max = Math.max(1, peak);
    const W = 560, H = 150, pad = 22, bw = W / Math.max(r.length, 1);
    const bars = r.map((x, i) => {
      const h = Math.round((Number(x.total) / max) * (H - pad - 16));
      return `<rect x="${(i * bw + 4).toFixed(1)}" y="${H - pad - h}" width="${(bw - 8).toFixed(1)}" height="${Math.max(h, 1)}" rx="3"><title>${esc(dayLabel(x.day))}: ${esc(sle(x.total))} (${x.n} payment${x.n === 1 ? "" : "s"})</title></rect>`;
    }).join("");
    return `<svg class="adm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Paid entry fees per day, last ${r.length} days">${bars}` +
      `<text x="4" y="${H - 6}">${esc(r.length ? dayLabel(r[0].day) : "")}</text>` +
      `<text x="${W - 4}" y="${H - 6}" text-anchor="end">${esc(r.length ? dayLabel(r[r.length - 1].day) : "")}</text>` +
      `<text x="${W - 4}" y="12" text-anchor="end">Best day: ${esc(sle(peak))}</text></svg>`;
  }

  async function overview(st, err) {
    if (err) return missing(err) ? SETUP : msg(err.message);
    const { data: rev } = await sb.rpc("admin_revenue_by_day", { p_days: 14 });
    const n = k => Number(st[k]) || 0;
    const tile = (v, label, href) => `<a class="card stat adm-tile" href="${href}"><b>${esc(v)}</b>${esc(label)}</a>`;
    const todo = [
      [n("refunds_requested"), "refund request(s) waiting for a decision", "#/admin/refunds"],
      [n("refunds_approved"), "approved refund(s) where the money still has to be sent", "#/admin/refunds"],
      [n("needs_refund"), "paid entr(ies) for full tournaments with no refund started", "#/admin/payments"],
      [n("disputes_open"), "disputed match(es)", "#/admin/reports"],
      [n("reports_open"), "open listing report(s)", "#/admin/reports"],
      [n("payments_pending"), "payment(s) still pending (last 3 days)", "#/admin/payments"]
    ].filter(x => x[0] > 0);
    return `<div class="adm-stats">
      ${tile(sle(st.revenue_total), "Paid entry fees, all time", "#/admin/payments")}
      ${tile(sle(st.revenue_30d), "Paid, last 30 days", "#/admin/payments")}
      ${tile(sle(st.refunded_total), "Refunded so far", "#/admin/refunds")}
      ${tile(n("users"), "Players (" + n("users_7d") + " new this week)", "#/admin/users")}
      ${tile(n("tournaments_open") + n("tournaments_live"), "Open or live tournaments", "#/admin/tournaments")}
      ${tile(n("listings_active"), "Active listings", "#/admin/reports")}
    </div>
    <div class="card"><h3>Needs your attention</h3>${todo.length ? `<ul class="adm-todo">${todo.map(([c, t, h]) => `<li><a href="${h}"><b>${c}</b> ${esc(t)}</a></li>`).join("")}</ul>` : `<p class="muted">Nothing needs attention right now.</p>`}</div>
    <div class="card"><h3>Paid entry fees, last 14 days</h3>${chart(rev)}<p class="muted sm">Counts payments confirmed by Monime, in SLE. Refunded payments are removed once the refund is recorded.</p></div>`;
  }

  /* ---------- Payments ---------- */
  async function payments() {
    const { data, error } = await sb.from("payments")
      .select("id,amount,currency,status,purpose,note,created_at,provider_order,profiles(username),tournaments(name),refund_requests(id,status)")
      .order("created_at", { ascending: false }).limit(300);
    if (error) return missing(error) ? SETUP : msg(error.message);
    payRows = data || [];
    const needs = p => p.status === "successful" && /^Tournament full/i.test(p.note || "") && !(p.refund_requests || []).length;
    const sum = s => payRows.filter(p => p.status === s && p.currency === "SLE").reduce((t, p) => t + Number(p.amount), 0);
    const cnt = s => payRows.filter(p => p.status === s).length;
    const chips = [["all", "All"], ["successful", "Paid"], ["pending", "Pending"], ["failed", "Failed"], ["refunded", "Refunded"], ["need", "Needs refund"]];
    const rows = payRows.map(p => {
      const who = p.profiles?.username || "?", what = p.tournaments?.name || p.purpose;
      const act = p.status === "successful"
        ? ((p.refund_requests || []).some(isOpenRefund)
          ? `<a class="tag" href="#/admin/refunds">Refund in progress</a>`
          : `<button class="btn sm alt" data-adm="open-refund" data-id="${p.id}">Refund</button>`)
        : "";
      return `<tr data-st="${esc(p.status)}" data-need="${needs(p) ? 1 : 0}" data-q="${esc([who, what, p.provider_order, p.note].join(" ").toLowerCase())}">
        <td>${esc(when(p.created_at))}</td><td>${esc(who)}</td><td>${esc(what)}${p.provider_order ? `<br><span class="muted sm">Order ${esc(p.provider_order)}</span>` : ""}${p.note ? `<br><span class="muted sm">${esc(p.note)}</span>` : ""}</td>
        <td>${esc(Number(p.amount).toLocaleString() + " " + p.currency)}</td><td>${pill(p.status)}${needs(p) ? ' <span class="tag s-disputed">needs refund</span>' : ""}</td><td>${act}</td></tr>`;
    }).join("");
    return `<div class="adm-sum"><span><b>${cnt("successful")}</b> paid · ${esc(sle(sum("successful")))}</span><span><b>${cnt("refunded")}</b> refunded · ${esc(sle(sum("refunded")))}</span><span><b>${cnt("pending")}</b> pending</span><span><b>${cnt("failed")}</b> failed</span></div>
    <div class="adm-filters">${chips.map(([v, t], i) => `<button type="button" class="chipbtn${i ? "" : " on"}" data-adm="pf" data-v="${v}">${esc(t)}</button>`).join("")}
      <input id="adm-pq" type="search" placeholder="Search player, tournament or order" aria-label="Search payments"><button type="button" class="btn sm alt" data-adm="csv">Download CSV</button></div>
    ${payRows.length ? `<div class="scroll"><table id="adm-pt"><thead><tr><th>Date</th><th>Player</th><th>For</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted sm">Showing the latest ${payRows.length} payments. Use the Monime dashboard for older history.</p>` : `<div class="empty">No payments yet.</div>`}`;
  }

  function applyPayFilter() {
    const f = app.querySelector("[data-adm='pf'].on"), v = f ? f.dataset.v : "all";
    const q = (app.querySelector("#adm-pq")?.value || "").trim().toLowerCase();
    app.querySelectorAll("#adm-pt tbody tr").forEach(tr => {
      const okS = v === "all" || (v === "need" ? tr.dataset.need === "1" : tr.dataset.st === v);
      tr.hidden = !(okS && (!q || tr.dataset.q.includes(q)));
    });
  }

  const csvCell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function exportCsv() {
    if (!payRows.length) return say("No payments to export.");
    const lines = [["Date", "Player", "For", "Amount", "Currency", "Status", "Order", "Note", "Refund"].map(csvCell).join(",")];
    payRows.forEach(p => lines.push([new Date(p.created_at).toISOString(), p.profiles?.username, p.tournaments?.name || p.purpose, p.amount, p.currency, p.status, p.provider_order,
      p.note, (p.refund_requests || []).map(r => r.status).join("/")].map(csvCell).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "gameboi-payments-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Refunds ---------- */
  async function refunds() {
    const { data, error } = await sb.from("refund_requests")
      .select("id,amount,currency,reason,source,status,admin_note,refund_reference,created_at,decided_at,u:profiles!refund_requests_user_id_fkey(username),d:profiles!refund_requests_decided_by_fkey(username),payments(provider_order,purpose,tournaments(name))")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return missing(error) ? SETUP : msg(error.message);
    const all = data || [];
    const card = (r, actions) => `<div class="card adm-r"><div class="row"><span><b>${esc(r.u?.username || "?")}</b> · <b>${esc(r.amount)} ${esc(r.currency)}</b> ${pill(r.status)}<br>
      <span class="muted sm">${esc(r.payments?.tournaments?.name || r.payments?.purpose || "Payment")}${r.payments?.provider_order ? " · Order " + esc(r.payments.provider_order) : ""} · ${esc(when(r.created_at))}${r.source === "admin" ? " · started by admin" : ""}</span><br>
      Reason: ${esc(r.reason)}${r.admin_note ? `<br><span class="muted sm">Admin note: ${esc(r.admin_note)}</span>` : ""}${r.refund_reference ? `<br><span class="muted sm">Refund reference: ${esc(r.refund_reference)}${r.d?.username ? " · by " + esc(r.d.username) : ""}</span>` : ""}</span>
      <span>${actions || ""}</span></div></div>`;
    const wait = all.filter(r => r.status === "requested"), send = all.filter(r => r.status === "approved"), done = all.filter(r => !isOpenRefund(r)).slice(0, 50);
    return `<h3>Waiting for a decision</h3>${wait.map(r => card(r, `<button class="btn sm" data-adm="approve" data-id="${r.id}">Approve</button><button class="btn sm alt" data-adm="reject" data-id="${r.id}">Decline</button>`)).join("") || `<div class="empty">No requests waiting.</div>`}
    <h3>Approved: send the money, then record it</h3><p class="muted sm">Send the money back from your Monime dashboard (find the payment by its order number) or by mobile money. Then press “Mark as refunded” and enter the transaction reference.</p>
    ${send.map(r => card(r, `<button class="btn sm" data-adm="paid" data-id="${r.id}">Mark as refunded</button>`)).join("") || `<div class="empty">Nothing to send.</div>`}
    <h3>History</h3>${done.map(r => card(r)).join("") || `<div class="empty">No finished refunds yet.</div>`}`;
  }

  /* ---------- Tournaments ---------- */
  async function tournaments() {
    const { data, error } = await sb.from("tournaments").select("id,name,status,entry_fee,currency,max_participants,start_at,games(name),participants(count)")
      .order("start_at", { ascending: false }).limit(60);
    if (error) return msg(error.message);
    const rows = (data || []).map(t => `<tr><td><a href="#/t/${t.id}">${esc(t.name)}</a><br><span class="muted sm">${esc(t.games?.name || "")}</span></td><td>${esc(when(t.start_at))}</td>
      <td>${Number(t.entry_fee) ? esc(t.entry_fee + " " + t.currency) : "Free"}</td><td>${esc(t.participants?.[0]?.count ?? 0)}/${esc(t.max_participants)}</td><td>${pill(t.status)}</td>
      <td>${["open", "closed", "live"].includes(t.status) ? `<button class="btn sm alt" data-adm="cancel-t" data-id="${t.id}" data-name="${esc(t.name)}">Cancel &amp; refund</button>` : ""}</td></tr>`).join("");
    return `<p class="muted">Cancelling a tournament tells every player and starts a refund for everyone who paid. You then send the money and record it on the Refunds tab.</p>
    ${rows ? `<div class="scroll"><table><thead><tr><th>Tournament</th><th>Starts</th><th>Entry</th><th>Players</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">No tournaments yet.</div>`}`;
  }

  /* ---------- Users ---------- */
  const urow = p => `<div class="card row adm-u"><span><b>${esc(p.username)}</b> ${p.suspended ? '<span class="tag s-disputed">suspended</span>' : ""}<br><span class="muted sm">Joined ${esc(new Date(p.created_at).toLocaleDateString())}</span></span>
    <span>${user && p.id === user.id ? '<span class="muted sm">You</span>' : `<button class="btn sm alt" data-adm="msg-user" data-id="${p.id}" data-name="${esc(p.username)}">Message</button><button class="btn sm${p.suspended ? "" : " alt"}" data-act="sus" data-id="${p.id}" data-v="${!p.suspended}">${p.suspended ? "Restore" : "Suspend"}</button>`}</span></div>`;
  async function users() {
    const { data, error } = await sb.from("profiles").select("id,username,suspended,created_at").order("created_at", { ascending: false }).limit(50);
    if (error) return msg(error.message);
    return `<form id="adm-us" class="adm-search"><input name="q" placeholder="Find a player by username" maxlength="20" aria-label="Find a player"><button class="btn sm">Search</button></form>
    <div id="adm-ul">${(data || []).map(urow).join("") || `<div class="empty">No players yet.</div>`}</div><p class="muted sm">Showing the newest 50. Use search to find anyone else. Admin rights can only be given in the Supabase SQL editor.</p>`;
  }

  /* ---------- Reports and disputes ---------- */
  async function reports() {
    const [r, d] = await Promise.all([
      sb.from("reports").select("*,listings(id,title,status)").eq("status", "open"),
      sb.from("matches").select("*,a:profiles!matches_p1_fkey(username),b:profiles!matches_p2_fkey(username)").eq("status", "disputed")]);
    return `<h3>Open listing reports</h3>${(r.data || []).map(x => `<div class="card row"><span>${esc(x.listings?.title)} — ${esc(x.reason)}</span><span><button class="btn sm" data-act="rm" data-id="${x.listing_id}">Remove listing</button><button class="btn sm alt" data-act="dis" data-id="${x.id}">Dismiss</button></span></div>`).join("") || `<div class="empty">No open reports.</div>`}
    <h3>Disputed matches</h3>${(d.data || []).map(m => `<div class="card row"><span>${esc(m.a?.username)} vs ${esc(m.b?.username)} (${esc(m.score1)}-${esc(m.score2)})</span><button class="btn sm" data-act="res" data-id="${m.id}">Set final score</button></div>`).join("") || `<div class="empty">No disputes.</div>`}`;
  }

  /* ---------- Messages ---------- */
  function messages() {
    const n = lastStats ? Math.max(0, (Number(lastStats.users) || 0) - (Number(lastStats.suspended) || 0)) : null;
    return `<div class="card"><h3>Message all players</h3><p class="muted sm">Shows in every player's notifications${n !== null ? " (about " + n + " people)" : ""}. Use it for maintenance, rule changes or news. It cannot be unsent.</p>
    <form id="adm-bc"><label>Message<textarea id="adm-bcb" name="body" rows="3" maxlength="300" required minlength="3" placeholder="e.g. Payments are back after a short pause. Thank you for waiting."></textarea></label><p class="muted sm"><span id="adm-bcn">0</span>/300</p><button class="btn">Send to everyone</button></form></div>
    <p class="muted sm">To message one player, open the Users tab and press Message next to their name.</p>`;
  }

  /* ---------- Activity (audit log) ---------- */
  const ACT = { open_refund: "Started a refund", approve_refund: "Approved a refund", reject_refund: "Declined a refund", mark_refunded: "Recorded a refund as sent", cancel_tournament: "Cancelled a tournament",
    broadcast: "Messaged all players", notify_user: "Messaged a player", resolve_dispute: "Resolved a dispute", set_listing: "Changed a listing", suspend: "Changed a suspension" };
  async function activity() {
    const { data, error } = await sb.from("audit_logs").select("*").order("id", { ascending: false }).limit(100);
    if (error) return msg(error.message);
    const rows = data || [], ids = [...new Set(rows.map(x => x.actor).filter(Boolean))];
    const { data: ps } = ids.length ? await sb.from("profiles").select("id,username").in("id", ids) : { data: [] };
    const nm = Object.fromEntries((ps || []).map(p => [p.id, p.username]));
    return rows.length ? `<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>${rows.map(x => {
      let det = ""; try { det = JSON.stringify(x.detail || {}); } catch (e) { }
      return `<tr><td>${esc(when(x.created_at))}</td><td>${esc(nm[x.actor] || "–")}</td><td>${esc(ACT[x.action] || x.action)}</td><td class="muted sm adm-det">${esc(det.length > 160 ? det.slice(0, 157) + "..." : det)}</td></tr>`;
    }).join("")}</tbody></table></div><p class="muted sm">Latest 100 admin actions.</p>` : `<div class="empty">No admin actions recorded yet.</div>`;
  }

  /* ---------- Page ---------- */
  const TAB = { payments, refunds, tournaments, users, reports, messages, activity };
  views["/admin"] = async sub => {
    if (!isAdmin) return `<div class="empty">Admins only.</div>`;
    const cur = Object.prototype.hasOwnProperty.call(TAB, sub) ? sub : "";
    const sr = await sb.rpc("admin_dashboard_stats");
    lastStats = sr.error ? null : sr.data;
    const body = cur === "" ? await overview(lastStats, sr.error) : await TAB[cur]();
    return head(cur, lastStats) + body;
  };

  /* ---------- Player side: ask for a refund on My payments ---------- */
  const oPay = views["/payments"];
  if (oPay) views["/payments"] = async () => {
    const h = await oPay();
    if (!user) return h;
    const [p, r] = await Promise.all([
      sb.from("payments").select("id,amount,currency,created_at,tournaments(name)").eq("user_id", user.id).eq("status", "successful").order("created_at", { ascending: false }).limit(50),
      sb.from("refund_requests").select("id,payment_id,amount,currency,status,reason,admin_note,refund_reference,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50)]);
    if (r.error || p.error) return h; // v9 not installed yet: page works as before
    const open = new Set((r.data || []).filter(isOpenRefund).map(x => x.payment_id));
    const can = (p.data || []).filter(x => !open.has(x.id));
    return h + (can.length ? `<h3>Need your money back?</h3><p class="muted sm">Entry fees are not refundable unless the tournament is cancelled or the host's rules say otherwise. You can still ask, and an admin will review it.</p>
      ${can.map(x => `<div class="card row"><span>${esc(x.tournaments?.name || "Entry fee")} · <b>${esc(x.amount)} ${esc(x.currency)}</b><br><span class="muted sm">${esc(when(x.created_at))}</span></span><button class="btn sm alt" data-adm="req-refund" data-id="${x.id}">Ask for a refund</button></div>`).join("")}` : "") +
      ((r.data || []).length ? `<h3>Your refund requests</h3>${r.data.map(x => `<div class="card row"><span><b>${esc(x.amount)} ${esc(x.currency)}</b> ${pill(x.status)}<br><span class="muted sm">${esc(when(x.created_at))} · ${esc(x.reason)}${x.admin_note ? " · Admin: " + esc(x.admin_note) : ""}${x.refund_reference ? " · Reference " + esc(x.refund_reference) : ""}</span></span></div>`).join("")}` : "");
  };

  /* ---------- Clicks, typing and forms (one listener each, so pages can re-render freely) ---------- */
  app.addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    const a = b.dataset.adm, id = b.dataset.id;
    if (a === "pf") { app.querySelectorAll("[data-adm='pf']").forEach(x => x.classList.toggle("on", x === b)); applyPayFilter(); return; }
    if (a === "csv") { exportCsv(); return; }
    if (b.disabled) return;
    let call = null, done = "Done.";
    const ask = (q, min) => { const t = prompt(q); if (t === null) return null; const s = t.trim(); if (s.length < (min || 0)) { alert("Please write at least " + min + " characters."); return null; } return s; };
    if (a === "req-refund") {
      const why = ask("Why do you want a refund? (a few words)", 3); if (why === null) return;
      call = () => sb.rpc("request_refund", { p_payment: id, p_reason: why }); done = "Refund request sent.";
    } else if (a === "open-refund") {
      const why = ask("Reason for this refund (kept in the record):", 3); if (why === null) return;
      if (!confirm("Start a refund for this payment? The player will be told it was approved.")) return;
      call = () => sb.rpc("admin_open_refund", { p_payment: id, p_reason: why }); done = "Refund started. Send the money, then record it on the Refunds tab.";
    } else if (a === "approve") {
      const note = ask("Optional note for your records (leave empty for none):", 0); if (note === null) return;
      call = () => sb.rpc("admin_decide_refund", { p_id: id, p_approve: true, p_note: note }); done = "Approved. Now send the money and record it.";
    } else if (a === "reject") {
      const note = ask("Why is it declined? The player will see this:", 3); if (note === null) return;
      call = () => sb.rpc("admin_decide_refund", { p_id: id, p_approve: false, p_note: note }); done = "Request declined.";
    } else if (a === "paid") {
      const ref = ask("Transaction reference of the refund (from Monime or your mobile money receipt):", 3); if (ref === null) return;
      if (!confirm("Confirm the money was really sent? The payment will be marked as refunded.")) return;
      call = () => sb.rpc("admin_mark_refunded", { p_id: id, p_reference: ref }); done = "Marked as refunded.";
    } else if (a === "cancel-t") {
      const why = ask("Why is “" + (b.dataset.name || "this tournament") + "” cancelled? Players will see this reason in the refund note:", 3); if (why === null) return;
      if (!confirm("Cancel this tournament? All players are told, and everyone who paid gets a refund. This cannot be undone.")) return;
      call = () => sb.rpc("admin_cancel_tournament", { p_t: id, p_reason: why }); done = n => "Tournament cancelled. " + n + " refund(s) started.";
    } else if (a === "msg-user") {
      const text = ask("Message to " + (b.dataset.name || "this player") + " (shows in their notifications):", 3); if (text === null) return;
      call = () => sb.rpc("admin_notify_user", { p_u: id, p_body: text }); done = "Message sent.";
    }
    if (!call) return;
    b.disabled = true;
    const { data, error } = await call();
    if (error) { b.disabled = false; alert(error.message); return; }
    say(typeof done === "function" ? done(data) : done);
    route();
  });

  app.addEventListener("input", e => {
    if (e.target.id === "adm-pq") applyPayFilter();
    if (e.target.id === "adm-bcb") { const c = app.querySelector("#adm-bcn"); if (c) c.textContent = e.target.value.length; }
  });

  app.addEventListener("submit", async e => {
    if (e.target.id === "adm-bc") {
      e.preventDefault();
      const body = (new FormData(e.target).get("body") || "").trim();
      if (body.length < 3) return;
      if (!confirm("Send this message to every player? It cannot be unsent.")) return;
      const btn = e.target.querySelector("button"); btn.disabled = true;
      const { data, error } = await sb.rpc("admin_broadcast", { p_body: body });
      btn.disabled = false;
      if (error) return alert(error.message);
      e.target.reset(); const c = app.querySelector("#adm-bcn"); if (c) c.textContent = "0";
      say("Sent to " + data + " player(s).");
    } else if (e.target.id === "adm-us") {
      e.preventDefault();
      const q = String(new FormData(e.target).get("q") || "").replace(/[^A-Za-z0-9_]/g, "");
      let qr = sb.from("profiles").select("id,username,suspended,created_at").order("created_at", { ascending: false }).limit(50);
      if (q) qr = qr.ilike("username", "%" + q + "%");
      const { data, error } = await qr;
      const box = app.querySelector("#adm-ul");
      if (box) box.innerHTML = error ? msg(error.message) : (data || []).map(urow).join("") || `<div class="empty">No player found.</div>`;
    }
  });
})();
