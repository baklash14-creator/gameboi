/* GAME BOI - nicer league table + leaderboard. Loads after features.js. */
(function () {
  "use strict";
  if (typeof views === "undefined") return;
  const medal = i => ["🥇", "🥈", "🥉"][i] || i + 1;
  function pretty(html, cols) {
    const box = document.createElement("div"); box.innerHTML = html;
    const t = box.querySelector(".scroll table"); if (!t) return html;
    const rows = [...t.querySelectorAll("tr")].slice(1).map(tr => [...tr.children].map(td => td.innerHTML));
    const idx = n => cols.indexOf(n);
    const num = (r, n) => parseInt(r[idx(n)].replace(/<[^>]*>/g, ""), 10) || 0;
    const max = Math.max(1, ...rows.map(r => num(r, "Pts")));
    const out = rows.map((r, i) => {
      const w = num(r, "W"), l = num(r, "L"), d = num(r, "D"), p = idx("P") >= 0 ? num(r, "P") : w + l + d;
      const form = p ? Math.round(w / p * 100) : 0;
      return `<div class="lt-row r${i < 3 ? i + 1 : ""}"><span class="lt-rank">${medal(i)}</span>
        <div class="lt-main"><b class="lt-name">${r[idx("Player")]}</b>
          <div class="lt-bar"><i style="width:${Math.round(num(r, "Pts") / max * 100)}%"></i></div>
          <small>${p} played · ${w}W ${d}D ${l}L · ${form}% wins</small></div>
        <span class="lt-pts"><b>${num(r, "Pts")}</b>pts</span></div>`;
    }).join("");
    t.closest(".scroll").outerHTML = `<div class="ltable">${out}</div>`;
    return box.innerHTML;
  }
  const oM = views["/m"];
  views["/m"] = async id => pretty(await oM(id), ["Player", "P", "W", "D", "L", "Pts"]);
  const oL = views["/leaderboard"];
  views["/leaderboard"] = async () => pretty(await oL(), ["#", "Player", "W", "L", "D", "Pts"]);
  if (typeof route === "function") route();
})();
