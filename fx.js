/* GAME BOI effects: toasts, confetti, scroll reveal, ripple, tilt, hero particles */
(function(){
  const rm=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const app=document.getElementById("app");
  const T=document.createElement("div");T.id="toasts";T.setAttribute("aria-live","polite");document.body.appendChild(T);
  function toast(m){const e=document.createElement("div");e.className="toast";e.textContent=m;T.appendChild(e);setTimeout(()=>{e.classList.add("out");setTimeout(()=>e.remove(),300)},2800)}
  function confetti(){if(rm)return;const c=document.createElement("canvas");c.id="confetti";c.width=innerWidth;c.height=innerHeight;document.body.appendChild(c);
    const x=c.getContext("2d"),cols=["#39ff14","#3b82f6","#ffffff","#facc15"];
    const P=Array.from({length:130},()=>({x:innerWidth/2,y:innerHeight*.35,vx:(Math.random()-.5)*14,vy:Math.random()*-12-3,s:Math.random()*6+3,c:cols[Math.random()*4|0],r:Math.random()*6}));let f=0;
    (function a(){x.clearRect(0,0,c.width,c.height);P.forEach(p=>{p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.r+=.2;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6);x.restore()});if(++f<110)requestAnimationFrame(a);else c.remove()})()}
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("show");io.unobserve(e.target)}}),{threshold:.06});
  function scan(){
    app.querySelectorAll(".card,.gtile,.sec,.stats3>div,.steps>div,.match,.pod,.empty,.hero2-in,.filters,table").forEach((e,i)=>{if(e.dataset.rv)return;e.dataset.rv=1;e.classList.add("rv");e.style.setProperty("--d",Math.min(i%8,7)*60+"ms");rm?e.classList.add("show"):io.observe(e)});
    const h=app.querySelector(".hero2");
    if(h&&!h.querySelector(".pt")&&!rm)for(let i=0;i<16;i++){const p=document.createElement("i");p.className="pt";p.style.cssText=`left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*4}s;animation-duration:${4+Math.random()*5}s`;h.appendChild(p)}
  }
  new MutationObserver(()=>requestAnimationFrame(()=>{app.classList.remove("pg");void app.offsetWidth;app.classList.add("pg");scan()})).observe(app,{childList:true});
  document.addEventListener("click",e=>{const b=e.target.closest(".btn");if(!b||rm)return;const r=b.getBoundingClientRect(),s=document.createElement("span"),d=Math.max(r.width,r.height);
    s.className="rip";s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;b.appendChild(s);setTimeout(()=>s.remove(),600)});
  if(matchMedia("(hover:hover)").matches&&!rm)document.addEventListener("mousemove",e=>{
    const c=e.target.closest(".tc,.gtile");document.querySelectorAll(".tilt").forEach(x=>{if(x!==c){x.style.transform="";x.classList.remove("tilt")}});
    if(!c)return;const r=c.getBoundingClientRect(),px=(e.clientX-r.left)/r.width-.5,py=(e.clientY-r.top)/r.height-.5;
    c.classList.add("tilt");c.style.transform=`perspective(700px) rotateX(${-py*6}deg) rotateY(${px*8}deg) translateY(-3px)`});
  window.GBfx={toast,confetti};scan();
})();
