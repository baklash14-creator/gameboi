/* GAME BOI v7: public bracket page, player rating (ELO), clans, daily check-in and badges.
   Loads after league.js. Needs supabase_schema_v7_elo_clans_badges.sql (run once in Supabase). */
(function () {
  "use strict";
  if (typeof views === "undefined" || typeof sb === "undefined" || !sb) return;
  const tip = m => { try { window.GBfx && GBfx.toast ? GBfx.toast(m) : alert(m); } catch (e) { alert(m); } };
  const BADGE = {
    first_win: ["🎯", "First win"], ten_matches: ["🎮", "10 matches"], champion: ["🏆", "Champion"],
    streak_3: ["🔥", "3-day streak"], streak_7: ["⚡", "7-day streak"], streak_30: ["💎", "30-day streak"],
    clan_founder: ["🛡️", "Clan founder"], clan_member: ["🤝", "Clan member"]
  };
  const badgeHtml = list => list && list.length
    ? `<div class="badges v7b">${list.map(b => { const x = BADGE[b.code] || ["⭐", b.code]; return `<span title="Earned ${esc(new Date(b.earned_at).toLocaleDateString())}">${x[0]} ${esc(x[1])}</span>`; }).join("")}</div>`
    : `<p class="muted sm">No badges yet. Win a match, check in daily or join a clan.</p>`;
  const missing = e => e && /relation|does not exist|schema cache|function/i.test(e.message || "");
  const setupNote = `<div class="msg">This part needs <b>supabase_schema_v7_elo_clans_badges.sql</b> to be run once in Supabase.</div>`;

  /* ---------- public bracket page ---------- */
  let bkTimer = null;
  async function bracketData(id) {
    const [{ data: t }, { data: ms }] = await Promise.all([
      sb.from("tournaments").select("id,name,format,status,games(name)").eq("id", id).single(),
      sb.from("matches").select("id,round,p1,p2,score1,score2,status,seq,a:profiles!matches_p1_fkey(username),b:profiles!matches_p2_fkey(username)").eq("tournament_id", id).order("seq")
    ]);
    return { t, ms: ms || [] };
  }
  const winnerOf = m => m.status !== "verified" ? null : !m.p2 ? "a" : m.score1 == null ? null : m.score1 > m.score2 ? "a" : m.score2 > m.score1 ? "b" : null;
  function bracketHtml(t, ms) {
    if (!t) return `<div class="empty">Tournament not found.</div>`;
    const head = `<p><a href="#/t/${esc(t.id)}">← Tournament page</a></p><h1>${esc(t.name)}</h1><p class="muted">${esc(t.games?.name || "")} · ${esc(t.format)} · <span class="pill s-${esc(t.status)}">${esc(t.status)}</span> <span class="muted sm">updates live</span></p>`;
    if (!ms.length) return head + `<div class="empty">Fixtures have not been drawn yet.</div>`;
    if (t.format === "league") return head + `<div class="msg">This is a league. <a href="#/m/${esc(t.id)}">See fixtures and the table</a>.</div>`;
    const rounds = {}; ms.forEach(m => (rounds[m.round] = rounds[m.round] || []).push(m));
    const keys = Object.keys(rounds).map(Number).sort((a, b) => a - b), last = keys[keys.length - 1];
    const finalM = rounds[last].length === 1 ? rounds[last][0] : null, w = finalM && winnerOf(finalM);
    const champ = t.status === "finished" && w ? (w === "a" ? finalM.a?.username : finalM.b?.username) : null;
    const name = (m, side) => { const p = side === "a" ? m.a : m.b, id = side === "a" ? m.p1 : m.p2; return id ? esc(p?.username || "?") : (m.round === keys[0] ? "BYE" : "TBD"); };
    const row = (m, side) => `<div class="bk-p ${winnerOf(m) === side ? "win" : winnerOf(m) ? "lose" : ""}"><span>${name(m, side)}</span><b>${side === "a" ? (m.score1 ?? "–") : (m.score2 ?? "–")}</b></div>`;
    const label = (r, i) => keys.length > 1 && r === last ? "Final" : keys.length > 2 && r === keys[keys.length - 2] ? "Semi-finals" : "Round " + r;
    return head + (champ ? `<div class="bk-champ">🏆 Champion: <b>${esc(champ)}</b></div>` : "") +
      `<div class="bk-scroll"><div class="bk" id="bk-root">${keys.map(r => `<div class="bk-col"><h3>${label(r)}</h3>${rounds[r].map(m => `<div class="bk-m s-${esc(m.status)}">${row(m, "a")}${row(m, "b")}</div>`).join("")}</div>`).join("")}</div></div>
      <p><button class="btn alt" data-v7="copy-bracket">Copy link to share</button></p>`;
  }
  views["/bracket"] = async id => {
    clearInterval(bkTimer);
    const { t, ms } = await bracketData(id);
    setTimeout(() => {
      bkTimer = setInterval(async () => {
        const box = document.getElementById("bk-root");
        if (!box || !location.hash.startsWith("#/bracket/")) { clearInterval(bkTimer); return; }
        try { const d = await bracketData(id); app.innerHTML = bracketHtml(d.t, d.ms); } catch (e) { /* keep showing the last bracket */ }
      }, 15000);
    }, 0);
    return bracketHtml(t, ms);
  };
  const oT = views["/t"];
  views["/t"] = async id => { const h = await oT(id); return h + `<p><a class="btn alt" href="#/bracket/${esc(id)}">View bracket</a></p>`; };

  /* ---------- rating board on the leaderboard ---------- */
  const oLb = views["/leaderboard"];
  views["/leaderboard"] = async () => {
    const h = await oLb();
    const { data, error } = await sb.from("elo_board").select("*").limit(20);
    if (error) return h + (missing(error) ? setupNote : "");
    return h + `<h2>Rating ranking</h2><p class="muted sm">A rating starts at 1000. Beat a higher-rated player and you gain more. Only verified matches count.</p>` +
      ((data || []).length ? `<div class="card toplist">${data.map((r, i) => `<div class="row"><span>${["🥇", "🥈", "🥉"][i] || i + 1} <a href="#/p/${esc(r.id)}">${esc(r.username)}</a></span><span><b>${r.elo}</b> <span class="muted sm">${r.rated} match${r.rated === 1 ? "" : "es"}</span></span></div>`).join("")}</div>` : `<div class="empty">No rated matches yet.</div>`);
  };

  /* ---------- player profile: rating, badges, clan ---------- */
  const oP = views["/p"];
  views["/p"] = async id => {
    const h = await oP(id);
    const [pr, bd, cm] = await Promise.all([
      sb.from("profiles").select("elo,streak,best_streak").eq("id", id).maybeSingle(),
      sb.from("badges").select("code,earned_at").eq("user_id", id).order("earned_at"),
      sb.from("clan_members").select("clans(id,name,tag)").eq("user_id", id).maybeSingle()
    ]);
    if (bd.error && missing(bd.error)) return h;
    const clan = cm.data?.clans;
    return h + `<div class="card v7p"><div class="row"><span>Rating</span><b>${pr.data?.elo ?? 1000}</b></div>
      <div class="row"><span>Best streak</span><b>${pr.data?.best_streak ?? 0} day${pr.data?.best_streak === 1 ? "" : "s"}</b></div>
      ${clan ? `<div class="row"><span>Clan</span><a href="#/clan/${esc(clan.id)}">[${esc(clan.tag)}] ${esc(clan.name)}</a></div>` : ""}</div>
      <h3>Badges</h3>${badgeHtml(bd.data)}`;
  };

  /* ---------- dashboard: daily check-in, streak, badges ---------- */
  const oMe = views["/me"];
  views["/me"] = async () => {
    const h = await oMe();
    if (!user) return h;
    const [pr, bd] = await Promise.all([
      sb.from("profiles").select("elo,streak,best_streak,last_checkin").eq("id", user.id).maybeSingle(),
      sb.from("badges").select("code,earned_at").eq("user_id", user.id).order("earned_at")
    ]);
    if (pr.error && missing(pr.error)) return h;
    const p = pr.data || {}, today = new Date().toISOString().slice(0, 10), done = p.last_checkin === today;
    const live = p.last_checkin && (p.last_checkin === today || p.last_checkin === new Date(Date.now() - 864e5).toISOString().slice(0, 10)) ? p.streak : 0;
    return h + `<h3>Daily check-in</h3><div class="card v7c"><div><b class="v7n">🔥 ${live}</b><span class="muted sm"> day streak · best ${p.best_streak || 0} · rating ${p.elo || 1000}</span></div>
      <button class="btn ${done ? "alt" : ""}" data-v7="checkin" ${done ? "disabled" : ""}>${done ? "Checked in today ✓" : "Check in"}</button></div>
      <h3>My badges</h3>${badgeHtml(bd.data)}<p><a class="btn alt" href="#/clans">Clans</a> <a class="btn alt" href="#/p/${esc(user.id)}">My public profile</a></p>`;
  };

  /* ---------- clans ---------- */
  views["/clans"] = async () => {
    const [{ data, error }, mine] = await Promise.all([
      sb.from("clan_board").select("*"),
      user ? sb.from("clan_members").select("clan_id").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    if (error) return `<h1>Clans</h1>${missing(error) ? setupNote : msg(error.message)}`;
    const myId = mine.data?.clan_id;
    const form = !user ? `<p class="muted">Log in to create or join a clan.</p>` : myId ? `<p><a class="btn alt" href="#/clan/${esc(myId)}">My clan</a></p>` :
      `<form id="v7clan" class="formcard"><h3>Create a clan</h3><label>Clan name<input name="name" required minlength="3" maxlength="30"></label>
       <label>Tag (2-5 letters or numbers)<input name="tag" required pattern="[A-Za-z0-9]{2,5}" maxlength="5"></label>
       <label>About<input name="desc" maxlength="200"></label><button class="btn">Create clan</button></form><div id="out"></div>`;
    return `<h1>Clans</h1><p class="muted">Team up. Clans are ranked by the average rating of their members.</p>${form}
      <div class="card toplist">${(data || []).map((c, i) => `<div class="row"><span>${i + 1}. <a href="#/clan/${esc(c.id)}">[${esc(c.tag)}] ${esc(c.name)}</a> <span class="muted sm">${c.members} member${c.members === 1 ? "" : "s"}</span></span><span><b>${c.avg_elo}</b>${user && !myId ? ` <button class="btn sm" data-v7="join" data-id="${esc(c.id)}">Join</button>` : ""}</span></div>`).join("") || `<div class="empty">No clans yet. Be the first.</div>`}</div>`;
  };
  views["/clan"] = async id => {
    const [{ data: c, error }, { data: mem }] = await Promise.all([
      sb.from("clan_board").select("*").eq("id", id).maybeSingle(),
      sb.from("clan_members").select("user_id,joined_at,profiles(username,elo)").eq("clan_id", id).order("joined_at")
    ]);
    if (error) return missing(error) ? setupNote : msg(error.message);
    if (!c) return `<div class="empty">Clan not found.</div>`;
    const list = (mem || []).slice().sort((a, b) => (b.profiles?.elo || 0) - (a.profiles?.elo || 0));
    const inIt = user && list.some(m => m.user_id === user.id), mineAny = user ? (await sb.from("clan_members").select("clan_id").eq("user_id", user.id).maybeSingle()).data : null;
    const owner = user && c.owner_id === user.id;
    return `<p><a href="#/clans">← All clans</a></p><h1>[${esc(c.tag)}] ${esc(c.name)}</h1><p class="muted">${esc(c.description || "")}</p>
      <div class="facts"><div><span>Members</span><b>${c.members}/30</b></div><div><span>Average rating</span><b>${c.avg_elo}</b></div></div>
      <p>${inIt ? `<button class="btn alt" data-v7="leave">Leave clan</button>` : user && !mineAny ? `<button class="btn" data-v7="join" data-id="${esc(c.id)}">Join clan</button>` : ""}</p>
      <h3>Members</h3><div class="card toplist">${list.map(m => `<div class="row"><span><a href="#/p/${esc(m.user_id)}">${esc(m.profiles?.username)}</a>${m.user_id === c.owner_id ? ' <span class="tag">owner</span>' : ""}</span><span><b>${m.profiles?.elo ?? 1000}</b>${owner && m.user_id !== user.id ? ` <button class="btn sm alt" data-v7="kick" data-id="${esc(m.user_id)}">Remove</button>` : ""}</span></div>`).join("")}</div>`;
  };

  /* ---------- actions ---------- */
  const run = async (btn, fn, ok) => {
    btn.disabled = true;
    try { const r = await fn(); if (r && r.error) throw r.error; if (ok) tip(ok); route(); }
    catch (e) { tip(e.message || "Something went wrong."); btn.disabled = false; }
  };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-v7]"); if (!b) return;
    const a = b.dataset.v7;
    if (a === "checkin") run(b, async () => {
      const { data, error } = await sb.rpc("daily_checkin"); if (error) return { error };
      tip(data?.already ? "Already checked in today." : `Streak: ${data.streak} day${data.streak === 1 ? "" : "s"} 🔥`);
    });
    else if (a === "join") run(b, () => sb.rpc("join_clan", { p_clan: b.dataset.id }), "You joined the clan");
    else if (a === "leave") { if (confirm("Leave this clan?")) run(b, () => sb.rpc("leave_clan"), "You left the clan"); }
    else if (a === "kick") { if (confirm("Remove this member?")) run(b, () => sb.rpc("remove_clan_member", { p_user: b.dataset.id }), "Member removed"); }
    else if (a === "copy-bracket") { const u = location.href; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => tip("Link copied"), () => prompt("Copy this link", u)); }
  });
  document.addEventListener("submit", async e => {
    if (e.target.id !== "v7clan") return;
    e.preventDefault();
    const v = fd(e.target), btn = e.target.querySelector("button"); btn.disabled = true;
    const { data, error } = await sb.rpc("create_clan", { p_name: v.name, p_tag: v.tag, p_desc: v.desc || null });
    if (error) { const o = document.getElementById("out"); if (o) o.innerHTML = msg(error.message); btn.disabled = false; return; }
    tip("Clan created"); location.hash = "#/clan/" + data;
  });

  if (typeof route === "function") route();
})();
