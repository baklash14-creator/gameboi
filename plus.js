/* GAME BOI - upgrade pack: listing photos, edit listing, edit tournament, smart register button.
   Loads after app.js. Needs supabase_schema_v5_images.sql run once in Supabase (for photo upload). */
(function () {
  "use strict";
  if (typeof views === "undefined" || typeof sb === "undefined" || !sb) return;

  const toast = m => { try { window.GBfx && GBfx.toast ? GBfx.toast(m) : alert(m); } catch (e) { alert(m); } };
  const BUCKET = "listing-images", MAX_PHOTOS = 3;

  /* ---------- photo helpers ---------- */
  function shrink(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          const s = Math.min(1, 900 / Math.max(im.width, im.height)), c = document.createElement("canvas");
          c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          c.toBlob(b => b ? res({ blob: b, url: URL.createObjectURL(b) }) : rej(new Error("compress failed")), "image/jpeg", 0.78);
        };
        im.onerror = rej; im.src = r.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }
  async function uploadAll(items) {
    const urls = [];
    for (let i = 0; i < items.length; i++) {
      const path = `${user.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, items[i].blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      urls.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  /* editor state for the listing form: old photos (urls) + new photos (blobs) */
  let P = { keep: [], add: [] };
  const paint = () => {
    const box = document.getElementById("photoPrev"); if (!box) return;
    const all = P.keep.map((u, i) => ({ u, k: "keep", i })).concat(P.add.map((x, i) => ({ u: x.url, k: "add", i })));
    box.innerHTML = all.map(p => `<div class="pv"><img src="${esc(p.u)}" alt=""><button type="button" data-rmimg="${p.k}:${p.i}" aria-label="Remove photo">×</button></div>`).join("");
    const n = document.getElementById("photoCount"); if (n) n.textContent = `${all.length}/${MAX_PHOTOS} photos`;
    const b = document.getElementById("photoBtn"); if (b) b.hidden = all.length >= MAX_PHOTOS;
  };

  /* ---------- listing form (sell + edit) ---------- */
  const listingForm = (l) => `<form id="lf2" class="formcard" ${l ? `data-id="${esc(l.id)}"` : ""}>
    <label>Title<input name="title" required minlength="5" maxlength="100" value="${esc(l?.title)}"></label>
    <label>Price (SLE)<input type="number" name="price" min="1" required value="${esc(l?.price)}"></label>
    <label>Team rating<input type="number" name="team_rating" min="0" max="5000" value="${esc(l?.team_rating)}"></label>
    <label>Featured players<input name="featured_players" value="${esc(l?.featured_players)}"></label>
    <label>Description<textarea name="description" rows="4">${esc(l?.description)}</textarea></label>
    <label>Safe contact method (no passwords or codes!)<input name="contact_method" value="${esc(l?.contact_method)}"></label>
    <label>Region<input name="region" value="${esc(l?.region)}"></label>
    <div class="photos"><div class="ph-head"><b>Photos</b><span class="muted sm" id="photoCount"></span></div>
      <div id="photoPrev" class="pvs"></div>
      <label class="btn alt" id="photoBtn">📷 Add photos<input type="file" id="photoIn" accept="image/*" multiple hidden></label>
      <p class="muted sm">Show your squad screen and team rating. Never show passwords, emails or codes. Max ${MAX_PHOTOS} photos.</p></div>
    <button class="btn wide" id="lfBtn">${l ? "Save changes" : "Publish listing"}</button></form><div id="out"></div>`;

  views["/sell"] = async () => {
    if (!user) return gate();
    P = { keep: [], add: [] };
    setTimeout(paint, 0);
    return `<h1>Sell an account</h1>${mwarn()}${listingForm(null)}`;
  };

  views["/edit"] = async id => {
    if (!user) return gate();
    const { data: l } = await sb.from("listings").select("*").eq("id", id).single();
    if (!l) return `<div class="empty">Listing not found.</div>`;
    if (l.seller_id !== user.id && !isAdmin) return `<div class="empty">You can only edit your own listing.</div>`;
    P = { keep: (l.image_urls || []).slice(), add: [] };
    setTimeout(paint, 0);
    return `<h1>Edit listing</h1><p><a href="#/l/${esc(id)}">← Back to listing</a></p>${listingForm(l)}`;
  };

  /* ---------- listing page: photo gallery, SOLD badge, edit + share buttons ---------- */
  const oL = views["/l"];
  views["/l"] = async id => {
    const h = await oL(id);
    const { data: l } = await sb.from("listings").select("seller_id,status,image_urls,contact_method").eq("id", id).single();
    if (!l) return h;
    const imgs = l.image_urls || [];
    const gal = imgs.length ? `<div class="gal"><img id="galMain" src="${esc(imgs[0])}" alt="Listing photo">${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" data-gal="${esc(u)}" class="${i ? "" : "on"}" alt="Photo ${i + 1}">`).join("")}</div>` : ""}</div>` : "";
    const badge = l.status !== "active" ? `<div class="msg">This listing is <b>${esc(l.status)}</b>.</div>` : "";
    const tools = `<p class="ltools"><button class="btn alt" id="lshare">Share</button>${l.contact_method ? `<button class="btn alt" id="lcopy" data-c="${esc(l.contact_method)}">Copy contact</button>` : ""}${user && l.seller_id === user.id ? `<a class="btn" href="#/edit/${esc(id)}">Edit listing</a>` : ""}</p>`;
    return h.replace(/(<\/h1>)/, `$1${badge}${gal}`) + tools;
  };

  /* ---------- tournament edit (host only: text fields, never dates or fees) ---------- */
  views["/edit-t"] = async id => {
    if (!user) return gate();
    const { data: t } = await sb.from("tournaments").select("*").eq("id", id).single();
    if (!t) return `<div class="empty">Tournament not found.</div>`;
    if (t.host_id !== user.id && !isAdmin) return `<div class="empty">Only the host can edit this tournament.</div>`;
    return `<h1>Edit tournament</h1><p><a href="#/t/${esc(id)}">← Back to tournament</a></p>
      <form id="tf2" class="formcard" data-id="${esc(id)}">
        <label>Name<input name="name" required minlength="3" maxlength="80" value="${esc(t.name)}"></label>
        <label>Contact method<input name="contact" value="${esc(t.contact)}"></label>
        <label>Rules<textarea name="rules" rows="5">${esc(t.rules)}</textarea></label>
        <label>Description<textarea name="description" rows="4">${esc(t.description)}</textarea></label>
        <p class="muted sm">Dates, entry fee and player limit are locked so players who joined or paid are not surprised.</p>
        <button class="btn wide">Save changes</button></form><div id="out"></div>`;
  };

  /* ---------- tournament page: honest register button (registered / full / closed) ---------- */
  const oT = views["/t"];
  views["/t"] = async id => {
    const h = await oT(id);
    if (!user) return h;
    const [t, ps] = await Promise.all([
      sb.from("tournaments").select("status,register_by,max_participants,host_id").eq("id", id).single(),
      sb.from("participants").select("user_id").eq("tournament_id", id).eq("status", "registered")
    ]);
    if (!t.data) return h;
    const reg = (ps.data || []), joined = reg.some(p => p.user_id === user.id);
    let label = null;
    if (joined) label = "✓ You're registered";
    else if (t.data.status !== "open" || new Date(t.data.register_by) < new Date()) label = "Registration closed";
    else if (reg.length >= t.data.max_participants) label = "Tournament full";
    const box = document.createElement("div"); box.innerHTML = h;
    const b = box.querySelector("#reg");
    if (b && label) { b.removeAttribute("id"); b.disabled = true; b.textContent = label; b.classList.add("done"); const c = box.querySelector("#code"); if (c) c.closest("label").remove(); }
    if (t.data.host_id === user.id) { const cta = box.querySelector(".cta"); if (cta) cta.insertAdjacentHTML("beforeend", `<a class="btn alt" href="#/edit-t/${esc(id)}">Edit</a>`); }
    return box.innerHTML;
  };

  /* ---------- events ---------- */
  document.addEventListener("change", async e => {
    if (e.target.id !== "photoIn") return;
    const files = [...e.target.files]; e.target.value = "";
    for (const f of files) {
      if (P.keep.length + P.add.length >= MAX_PHOTOS) { toast(`You can add up to ${MAX_PHOTOS} photos.`); break; }
      try { P.add.push(await shrink(f)); } catch (x) { toast("Could not read that photo."); }
    }
    paint();
  });

  document.addEventListener("click", e => {
    let el;
    if ((el = e.target.closest("[data-rmimg]"))) {
      const [k, i] = el.dataset.rmimg.split(":"); (k === "keep" ? P.keep : P.add).splice(+i, 1); paint(); return;
    }
    if ((el = e.target.closest("[data-gal]"))) {
      const m = document.getElementById("galMain"); if (m) m.src = el.dataset.gal;
      document.querySelectorAll(".gal .thumbs img").forEach(x => x.classList.toggle("on", x === el)); return;
    }
    if (e.target.closest("#lshare")) {
      const data = { title: document.title, url: location.href };
      (navigator.share ? navigator.share(data) : navigator.clipboard.writeText(location.href).then(() => toast("Link copied"))).catch(() => { });
      return;
    }
    if ((el = e.target.closest("#lcopy"))) {
      navigator.clipboard.writeText(el.dataset.c).then(() => toast("Contact copied")).catch(() => { });
    }
  });

  document.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "lf2") {
      e.preventDefault();
      const btn = document.getElementById("lfBtn"), v = fd(f), id = f.dataset.id;
      btn.disabled = true; const old = btn.textContent; btn.textContent = "Saving…";
      try {
        const fresh = P.add.length ? await uploadAll(P.add) : [];
        const row = {
          title: v.title.trim(), description: v.description, featured_players: v.featured_players,
          contact_method: v.contact_method, region: v.region, price: +v.price,
          team_rating: v.team_rating ? +v.team_rating : null, image_urls: P.keep.concat(fresh)
        };
        const r = id ? await sb.from("listings").update(row).eq("id", id).select().single()
                     : await sb.from("listings").insert({ ...row, seller_id: user.id }).select().single();
        if (r.error) throw r.error;
        toast(id ? "Listing updated" : "Listing published");
        location.hash = "#/l/" + r.data.id;
      } catch (x) {
        out(/bucket|storage|row-level|policy/i.test(x.message || "") ? "Photo upload is not switched on yet. Run supabase_schema_v5_images.sql in Supabase." : (x.message || "Could not save."));
        btn.disabled = false; btn.textContent = old;
      }
    }
    if (f.id === "tf2") {
      e.preventDefault(); const v = fd(f), btn = f.querySelector("button"); btn.disabled = true;
      const { error } = await sb.from("tournaments").update({ name: v.name.trim(), contact: v.contact, rules: v.rules, description: v.description }).eq("id", f.dataset.id);
      if (error) { out(error.message); btn.disabled = false; return; }
      toast("Tournament updated"); location.hash = "#/t/" + f.dataset.id;
    }
  });

  /* app.js may already have drawn the first page before this file loaded, so draw it once more with the new views */
  if (typeof route === "function") route();
})();
