/* GAME BOI - features pack: match chat + disputes, player profiles, prize payouts, invite + share card,
   phone alerts, seller ratings, stream links. Loads after plus.js. Needs supabase_schema_v6_features.sql. */
(function () {
  "use strict";
  if (typeof views === "undefined" || typeof sb === "undefined" || !sb) return;
  const toast = m => { try { window.GBfx && GBfx.toast ? GBfx.toast(m) : alert(m); } catch (e) { alert(m); } };
  const when = d => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const ago = d => { const s = Math.max(1, (Date.now() - new Date(d)) / 1000); return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
  const needSql = e => /relation|does not exist|function|schema cache|stream_url/i.test((e && e.message) || "") ? "Run supabase_schema_v6_features.sql in Supabase first." : ((e && e.message) || "Something went wrong.");
  const dom = h => { const d = document.createElement("div"); d.innerHTML = h; return d; };
  const APP_URL = location.origin + location.pathname;

  /* ---------- fixtures page: chat links, my-match highlight, stream + payouts for the host ---------- */
  const oM = views["/m"];
  views["/m"] = async id => {
    const h = await oM(id);
    const [{ data: t }, { data: ms }] = await Promise.all([
      sb.from("tournaments").select("host_id,currency,prize_pool,stream_url,status").eq("id", id).single(),
      sb.from("matches").select("id,round,p1,p2,status").eq("tournament_id", id).order("seq")
    ]);
    if (!t) return h;
    const box = dom(h), cards = [...box.querySelectorAll(".match")];
    const byRound = {}; (ms || []).forEach(m => (byRound[m.round] = byRound[m.round] || []).push(m));
    const flat = Object.keys(byRound).map(Number).sort((a, b) => a - b).flatMap(r => byRound[r]);
    const isHost = user && t.host_id === user.id;
    cards.forEach((c, i) => {
      const m = flat[i]; if (!m) return;
      const mine = user && (m.p1 === user.id || m.p2 === user.id);
      if (mine) c.classList.add("mine");
      if (m.p2 && (mine || isHost || isAdmin)) c.insertAdjacentHTML("beforeend", `<a class="btn sm alt chatlink" href="#/mc/${m.id}">💬 Match chat</a>`);
    });
    let extra = "";
    if (isHost || isAdmin) {
      extra += `<h3>Live stream link</h3><form class="card" id="streamF" data-id="${esc(id)}">
        <input name="url" type="url" placeholder="https://youtube.com/live/..." value="${esc(t.stream_url || "")}">
        <button class="btn sm wide">Save link</button><p class="muted sm">YouTube, Facebook, Twitch or TikTok live link. Leave empty to remove it.</p></form>`;
      if (flat.length) {
        const { data: ps } = await sb.from("participants").select("user_id,profiles(username)").eq("tournament_id", id).eq("status", "registered");
        const { data: po } = await sb.from("payouts").select("*").eq("tournament_id", id).order("place");
        const opts = (ps || []).map(p => `<option value="${esc(p.user_id)}">${esc(p.profiles?.username)}</option>`).join("");
        const rows = [1, 2, 3].map(pl => {
          const r = (po || []).find(x => x.place === pl);
          return `<form class="payrow" data-id="${esc(id)}" data-place="${pl}"><b>${["🥇", "🥈", "🥉"][pl - 1]}</b>
            <select name="u" ${r && r.status === "paid" ? "disabled" : ""}>${opts.replace(`value="${r ? r.user_id : "-"}"`, `value="${r ? r.user_id : "-"}" selected`)}</select>
            <input name="a" type="number" min="0" step="1" placeholder="Amount" value="${r ? esc(r.amount) : ""}" ${r && r.status === "paid" ? "disabled" : ""}>
            ${r && r.status === "paid" ? `<span class="tag s-verified">paid</span>` : `<button class="btn sm">Save</button>${r ? `<button type="button" class="btn sm alt" data-paid="${esc(r.id)}">Mark paid</button>` : ""}`}</form>`;
        }).join("");
        extra += `<h3>Prize payouts</h3><div class="card"><p class="muted sm">Record who won and mark each prize paid after you send it. Players see this list. GAME BOI does not move prize money.</p>${rows}</div>`;
      }
    }
    return box.innerHTML + extra;
  };

  /* ---------- tournament page: stream, payouts list, invite ---------- */
  const oT = views["/t"];
  views["/t"] = async id => {
    const h = await oT(id);
    const [{ data: t }, { data: po }] = await Promise.all([
      sb.from("tournaments").select("name,stream_url,currency,games(name),prize_pool").eq("id", id).single(),
      sb.from("payouts").select("place,amount,status,profiles(username)").eq("tournament_id", id).order("place")
    ]);
    if (!t) return h;
    const box = dom(h);
    const bn = box.querySelector(".banner");
    let add = "";
    if (t.stream_url && /^https:\/\//i.test(t.stream_url)) add += `<a class="btn live" href="${esc(t.stream_url)}" target="_blank" rel="noopener noreferrer">▶ Watch live</a>`;
    add += `<button class="btn alt" data-invite="${esc(id)}">📣 Invite friends</button><a class="btn alt" href="#/m/${esc(id)}">Fixtures</a>`;
    if (bn) bn.insertAdjacentHTML("afterend", `<p class="trow">${add}</p>`);
    if (po && po.length) box.insertAdjacentHTML("beforeend", `<h3>Prizes</h3><div class="card">${po.map(p => `<div class="row"><span>${["🥇", "🥈", "🥉"][p.place - 1] || "#" + p.place} ${esc(p.profiles?.username)}</span><span>${money(p.amount, t.currency)} <span class="tag ${p.status === "paid" ? "s-verified" : ""}">${esc(p.status)}</span></span></div>`).join("")}</div>`);
    return box.innerHTML;
  };

  /* ---------- match chat ---------- */
  let chatTimer = null;
  views["/mc"] = async id => {
    if (!user) return gate();
    const { data: m, error } = await sb.from("matches").select("*,a:profiles!matches_p1_fkey(username),b:profiles!matches_p2_fkey(username),tournaments(name,id)").eq("id", id).single();
    if (error || !m) return `<div class="empty">Match not found, or you are not part of it.</div>`;
    clearInterval(chatTimer);
    setTimeout(() => { loadChat(id); chatTimer = setInterval(() => { if (!document.getElementById("chatbox")) return clearInterval(chatTimer); loadChat(id); }, 5000); }, 0);
    const canDispute = m.status === "reported" && m.reported_by !== user.id && (m.p1 === user.id || m.p2 === user.id);
    return `<h1>Match chat</h1><p><a href="#/m/${esc(m.tournaments.id)}">← ${esc(m.tournaments.name)} fixtures</a></p>
      <div class="card"><div class="vs"><b>${esc(m.a?.username || "TBD")}</b><span>${m.score1 ?? "–"} : ${m.score2 ?? "–"}</span><b>${esc(m.b?.username || "BYE")}</b></div>
      <span class="tag s-${esc(m.status)}">${esc(m.status)}</span>
      ${canDispute ? `<p><button class="btn sm" data-act="ok" data-id="${esc(id)}">Confirm score</button> <button class="btn sm alt" data-act="no" data-id="${esc(id)}">Dispute score</button></p>` : ""}</div>
      <p class="muted sm">Agree a time and share your game ID here. Never share passwords or codes. Admins can read this chat if a score is disputed.</p>
      <div id="chatbox" class="chatbox"><p class="muted">Loading…</p></div>
      <form id="chatF" class="chatf" data-id="${esc(id)}"><input name="b" maxlength="500" placeholder="Type a message" autocomplete="off" required><button class="btn">Send</button></form><div id="out"></div>`;
  };
  async function loadChat(id) {
    const box = document.getElementById("chatbox"); if (!box) return;
    const { data, error } = await sb.from("match_messages").select("id,body,kind,user_id,created_at,profiles(username)").eq("match_id", id).order("created_at").limit(200);
    if (error) { box.innerHTML = `<p class="muted">${esc(needSql(error))}</p>`; return; }
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = (data || []).length ? data.map(x => `<div class="bub ${x.user_id === user.id ? "me" : ""} ${x.kind}"><small>${x.kind === "dispute" ? "⚠ Dispute · " : ""}${esc(x.profiles?.username)} · ${ago(x.created_at)}</small>${esc(x.body)}</div>`).join("") : `<p class="muted">No messages yet. Say hi 👋</p>`;
    if (stick) box.scrollTop = box.scrollHeight;
  }

  /* ---------- player profile ---------- */
  views["/p"] = async id => {
    if (!user) return gate();
    const [{ data: p }, st, ss, rm] = await Promise.all([
      sb.from("profiles").select("id,username,avatar_url,created_at").eq("id", id).single(),
      sb.rpc("player_stats", { p: id }),
      sb.from("seller_stats").select("*").eq("seller_id", id).maybeSingle(),
      sb.from("matches").select("id,score1,score2,p1,p2,a:profiles!matches_p1_fkey(username),b:profiles!matches_p2_fkey(username)").eq("status", "verified").or(`p1.eq.${id},p2.eq.${id}`).order("seq", { ascending: false }).limit(6)
    ]);
    if (!p) return `<div class="empty">Player not found.</div>`;
    const s = (Array.isArray(st.data) ? st.data[0] : st.data) || { played: 0, wins: 0, losses: 0, draws: 0, tournaments: 0, prizes: 0 };
    const sell = ss.data, trusted = sell && sell.n >= 3 && Number(sell.avg_stars) >= 4;
    const badges = [];
    if (s.wins >= 1) badges.push("🎯 First win"); if (s.wins >= 5) badges.push("🔥 5 wins"); if (s.wins >= 20) badges.push("👑 20 wins");
    if (s.tournaments >= 3) badges.push("🎮 Regular"); if (s.prizes >= 1) badges.push("🏆 Champion"); if (trusted) badges.push("✅ Trusted seller");
    const rate = s.played ? Math.round(s.wins / s.played * 100) : 0;
    return `<div class="pcard"><div class="av big">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(p.username[0].toUpperCase())}</div>
      <h1>${esc(p.username)}</h1><p class="muted sm">Member since ${new Date(p.created_at).toLocaleDateString([], { month: "short", year: "numeric" })}</p>
      <div class="badges">${badges.length ? badges.map(b => `<span>${b}</span>`).join("") : `<span class="muted">No badges yet. Play to earn them.</span>`}</div></div>
      <div class="stats"><div class="card stat"><b>${s.played}</b>Matches</div><div class="card stat"><b>${s.wins}</b>Wins</div><div class="card stat"><b>${rate}%</b>Win rate</div><div class="card stat"><b>${s.tournaments}</b>Tournaments</div></div>
      ${sell ? `<p class="card">Seller rating: <b>★ ${sell.avg_stars}</b> from ${sell.n} review${sell.n === 1 ? "" : "s"} ${trusted ? '<span class="tag s-verified">Trusted</span>' : ""}</p>` : ""}
      <h3>Recent results</h3>${(rm.data || []).map(m => `<div class="card row"><span>${esc(m.a?.username)} vs ${esc(m.b?.username)}</span><b>${m.score1}-${m.score2}</b></div>`).join("") || `<div class="empty">No verified matches yet.</div>`}`;
  };
  const oLb = views["/leaderboard"];
  views["/leaderboard"] = async () => {
    let h = await oLb();
    const { data } = await sb.from("leaderboard").select("id,username");
    (data || []).forEach(r => {
      const n = esc(r.username), a = `<a href="#/p/${esc(r.id)}">${n}</a>`;
      h = h.split(`<td>${n}</td>`).join(`<td>${a}</td>`).split(`<b>${n}</b>`).join(`<b>${a}</b>`);
    });
    return h;
  };

  /* ---------- listing page: seller rating + reviews ---------- */
  const oL = views["/l"];
  views["/l"] = async id => {
    const h = await oL(id);
    const { data: l } = await sb.from("listings").select("seller_id,profiles(username)").eq("id", id).single();
    if (!l) return h;
    const [ss, rv] = await Promise.all([
      sb.from("seller_stats").select("*").eq("seller_id", l.seller_id).maybeSingle(),
      sb.from("seller_ratings").select("stars,comment,created_at,rater_id,profiles!seller_ratings_rater_id_fkey(username)").eq("listing_id", id).order("created_at", { ascending: false }).limit(10)
    ]);
    if (rv.error) return h;
    const sell = ss.data, trusted = sell && sell.n >= 3 && Number(sell.avg_stars) >= 4;
    const mine = user && (rv.data || []).some(r => r.rater_id === user.id);
    const head = `<p class="sellerline">Seller <a href="#/p/${esc(l.seller_id)}"><b>${esc(l.profiles?.username)}</b></a> · ${sell ? `<span class="stars">★ ${sell.avg_stars}</span> (${sell.n})` : `<span class="muted">No ratings yet</span>`} ${trusted ? '<span class="tag s-verified">✅ Trusted seller</span>' : ""}</p>`;
    let form = "";
    if (user && user.id !== l.seller_id && !mine) form = `<form id="rateF" class="card" data-l="${esc(id)}" data-s="${esc(l.seller_id)}"><b>Rate this seller</b>
      <div class="starpick">${[5, 4, 3, 2, 1].map(n => `<label><input type="radio" name="stars" value="${n}" ${n === 5 ? "checked" : ""}><span>★</span></label>`).join("")}</div>
      <input name="comment" maxlength="300" placeholder="How did the deal go? (optional)"><button class="btn sm wide">Submit rating</button>
      <p class="muted sm">Only rate after you dealt with this seller. Honest reviews help everyone.</p></form><div id="out"></div>`;
    const list = (rv.data || []).length ? `<h3>Reviews</h3>${rv.data.map(r => `<div class="card"><b class="stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</b> <span class="muted sm">${esc(r.profiles?.username)} · ${ago(r.created_at)}</span>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</div>`).join("")}` : "";
    return h.replace(/(<\/h1>)/, `$1${head}`) + form + list;
  };

  /* ---------- invite page + share card ---------- */
  views["/invite"] = async () => {
    if (!user) return gate();
    return `<h1>Invite friends</h1><div class="card"><p>Bring your squad to GAME BOI. Share the link and compete together.</p>
      <p class="invlink">${esc(APP_URL)}</p><p class="ltools"><button class="btn" data-invite="app">📣 Share</button><button class="btn alt" data-copyapp>Copy link</button>
      <a class="btn alt" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("Join me on GAME BOI - esports tournaments and eFootball accounts in Sierra Leone: " + APP_URL)}">WhatsApp</a></p></div>`;
  };
  function wrap(ctx, text, x, y, w, lh) {
    const words = String(text).split(" "); let line = "";
    for (const wd of words) { const t = line + wd + " "; if (ctx.measureText(t).width > w && line) { ctx.fillText(line.trim(), x, y); line = wd + " "; y += lh; } else line = t; }
    ctx.fillText(line.trim(), x, y); return y;
  }
  async function shareCard(kind, id) {
    let title = "GAME BOI", sub = "Esports tournaments & eFootball accounts", info = "Join me on GAME BOI", url = APP_URL;
    if (kind !== "app") {
      const { data: t } = await sb.from("tournaments").select("name,format,start_at,prize_pool,entry_fee,currency,games(name)").eq("id", id).single();
      if (t) { title = t.name; sub = `${t.games?.name || ""} · ${t.format}`; info = `Prize ${prize(t.prize_pool, t.currency)}  ·  Entry ${money(t.entry_fee, t.currency)}  ·  ${when(t.start_at)}`; url = APP_URL + "#/t/" + id; }
    }
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1080; const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 1080, 1080); gr.addColorStop(0, "#07102a"); gr.addColorStop(1, "#12306b"); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = "#39ff14"; g.fillRect(70, 90, 140, 10);
    g.fillStyle = "#39ff14"; g.font = "800 44px system-ui,sans-serif"; g.fillText("GAME BOI", 70, 160);
    g.fillStyle = "#fff"; g.font = "800 84px system-ui,sans-serif"; const ly = wrap(g, title, 70, 400, 940, 98);
    g.fillStyle = "#9db4ff"; g.font = "600 44px system-ui,sans-serif"; g.fillText(sub, 70, ly + 80);
    g.fillStyle = "#fff"; g.font = "600 36px system-ui,sans-serif"; wrap(g, info, 70, ly + 160, 940, 50);
    g.fillStyle = "#39ff14"; g.fillRect(70, 900, 940, 110); g.fillStyle = "#07102a"; g.font = "800 38px system-ui,sans-serif"; g.fillText("Join now: " + url.replace(/^https?:\/\//, "").slice(0, 38), 100, 970);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    const file = new File([blob], "gameboi-invite.png", { type: "image/png" });
    const text = (kind === "app" ? "Join me on GAME BOI!" : `Join "${title}" on GAME BOI!`) + " " + url;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, url }); return; }
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gameboi-invite.png"; a.click();
    try { await navigator.clipboard.writeText(text); toast("Card saved and link copied"); } catch (e) { toast("Card saved"); }
  }

  /* ---------- phone alerts (works while the app is open or installed) ---------- */
  let seen = new Date().toISOString(), alertTimer = null;
  function startAlerts() {
    clearInterval(alertTimer);
    if (!user) return;
    alertTimer = setInterval(async () => {
      if (!user || document.hidden && Notification.permission !== "granted") return;
      const { data } = await sb.from("notifications").select("id,body,created_at").eq("user_id", user.id).eq("read", false).gt("created_at", seen).order("created_at");
      if (!data || !data.length) return;
      seen = data[data.length - 1].created_at;
      data.forEach(n => {
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) { try { new Notification("GAME BOI", { body: n.body, icon: "icon-192.png" }); } catch (e) { } }
        else toast(n.body);
      });
    }, 20000);
  }
  startAlerts();
  addEventListener("hashchange", () => { if (user && !alertTimer) startAlerts(); });
  const oN = views["/notifications"];
  views["/notifications"] = async () => {
    const h = await oN();
    const can = typeof Notification !== "undefined";
    const st = can ? Notification.permission : "unsupported";
    const bar = `<div class="card alertbar">${st === "granted" ? "🔔 Phone alerts are on while the app is open." : st === "denied" ? "🔕 Alerts are blocked in your browser settings." : can ? `<button class="btn sm" data-alerts>🔔 Turn on phone alerts</button>` : "Alerts are not supported on this browser."}
      <p class="muted sm">Alerts arrive while GAME BOI is open or installed on your home screen.</p></div>`;
    return h.replace(/(<\/div>)/, `$1${bar}`);
  };
  const oMe = views["/me"];
  views["/me"] = async () => { const h = await oMe(); return h + (user ? `<p><a class="btn alt" href="#/p/${esc(user.id)}">My public profile</a><a class="btn alt" href="#/invite">Invite friends</a></p>` : ""); };

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-act='no']");
    if (b) {
      e.stopImmediatePropagation(); e.preventDefault();
      const reason = prompt("What is wrong with this score? (e.g. I won 3-1, not 2-1)"); if (!reason) return;
      const { error } = await sb.rpc("dispute_match", { p_m: b.dataset.id, p_reason: reason });
      if (error) { toast(needSql(error)); return; }
      toast("Dispute sent. An admin will review it."); route(); return;
    }
    let el;
    if ((el = e.target.closest("[data-invite]"))) { el.disabled = true; try { await shareCard(el.dataset.invite === "app" ? "app" : "t", el.dataset.invite); } finally { el.disabled = false; } return; }
    if (e.target.closest("[data-copyapp]")) { navigator.clipboard.writeText(APP_URL).then(() => toast("Link copied")).catch(() => { }); return; }
    if (e.target.closest("[data-alerts]")) {
      const r = await Notification.requestPermission(); toast(r === "granted" ? "Alerts are on" : "Alerts not allowed"); route(); return;
    }
    if ((el = e.target.closest("[data-paid]"))) {
      const note = prompt("How did you pay? (e.g. Orange Money, cash) - optional") ?? null; if (note === null) return;
      const { error } = await sb.rpc("mark_payout_paid", { p_id: el.dataset.paid, p_note: note });
      if (error) toast(needSql(error)); else { toast("Marked as paid"); route(); }
    }
  }, true);

  document.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "chatF") {
      e.preventDefault(); const inp = f.elements.b, body = inp.value.trim(); if (!body) return;
      inp.value = "";
      const { error } = await sb.from("match_messages").insert({ match_id: f.dataset.id, user_id: user.id, body });
      if (error) { inp.value = body; out(needSql(error)); return; }
      loadChat(f.dataset.id);
    } else if (f.id === "streamF") {
      e.preventDefault();
      const { error } = await sb.rpc("set_stream", { p_t: f.dataset.id, p_url: f.elements.url.value.trim() });
      toast(error ? needSql(error) : "Stream link saved");
    } else if (f.classList.contains("payrow")) {
      e.preventDefault(); const v = fd(f);
      const { error } = await sb.rpc("set_payout", { p_t: f.dataset.id, p_place: +f.dataset.place, p_user: v.u, p_amount: +v.a || 0 });
      if (error) toast(needSql(error)); else { toast("Saved"); route(); }
    } else if (f.id === "rateF") {
      e.preventDefault(); const v = fd(f), btn = f.querySelector("button"); btn.disabled = true;
      const { error } = await sb.from("seller_ratings").insert({ listing_id: f.dataset.l, seller_id: f.dataset.s, rater_id: user.id, stars: +v.stars, comment: (v.comment || "").trim() || null });
      if (error) { out(/duplicate/i.test(error.message) ? "You already rated this listing." : needSql(error)); btn.disabled = false; return; }
      toast("Thanks for your rating"); route();
    }
  }, true);

  if (typeof route === "function") route();
})();
