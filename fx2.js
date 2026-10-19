/* GAME BOI extra animations: splash, scroll bar, parallax, ticker, word reveal */
(function(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const app=document.getElementById("app");
  const sp=document.createElement("div");sp.id="splash";
  sp.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 26h36a8 8 0 0 1 8 9l-2 9a5 5 0 0 1-9 1l-3-5H20l-3 5a5 5 0 0 1-9-1l-2-9a8 8 0 0 1 8-9z" fill="#39ff14"/><path d="M20 31v6M17 34h6" stroke="#05070d" stroke-width="2.5"/><circle cx="43" cy="32" r="2" fill="#05070d"/><circle cx="48" cy="36" r="2" fill="#05070d"/></svg><b>GAME BOI</b><i></i>';
  document.body.appendChild(sp);
  const hide=()=>{sp.classList.add("out");setTimeout(()=>sp.remove(),600)};
  addEventListener("load",()=>setTimeout(hide,900));setTimeout(hide,2600);
  const pb=document.createElement("div");pb.id="prog";document.body.appendChild(pb);
  addEventListener("scroll",()=>{const h=document.documentElement;pb.style.width=(h.scrollTop/((h.scrollHeight-h.clientHeight)||1)*100)+"%"},{passive:true});
  document.addEventListener("mousemove",e=>{const a=document.querySelector(".hero2-art");if(!a)return;
    a.style.setProperty("--px",((e.clientX/innerWidth-.5)*18)+"px");a.style.setProperty("--py",((e.clientY/innerHeight-.5)*18)+"px")});
  function enhance(){
    const h=app.querySelector(".hero2");
    if(h&&!h.querySelector(".ticker")){const items=["PLAY","COMPETE","WIN","eFootball","Call of Duty","Fortnite","EA SPORTS FC","TOURNAMENTS","LEADERBOARDS"];
      const s=items.map(x=>`<span>${x}</span>`).join("");const t=document.createElement("div");t.className="ticker";t.setAttribute("aria-hidden","true");t.innerHTML=`<div>${s}${s}</div>`;h.appendChild(t)}
    app.querySelectorAll("h1").forEach(el=>{if(el.dataset.sp||el.children.length||el.closest(".hero2")||el.closest(".auth-card"))return;
      el.dataset.sp=1;const t=el.textContent;el.textContent="";t.split(" ").forEach((w,i)=>{const s=document.createElement("span");s.className="w";s.style.setProperty("--i",i);s.textContent=w;el.append(s," ")})});
  }
  new MutationObserver(()=>requestAnimationFrame(enhance)).observe(app,{childList:true});enhance();
})();
