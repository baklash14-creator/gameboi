/* v8: plain-language helper text on key pages. Runs after each page render. */
(function(){
  var app=document.getElementById("app");if(!app)return;
  var HELP={
    games:"Pick a game to see the tournaments you can join.",
    tournaments:"Tap a tournament to see the details and join. Free ones take one tap. Paid ones use mobile money (Orange Money or Afrimoney).",
    host:"Start your own tournament in about two minutes. Choose the game, the date, how many players, and the entry fee (or leave it free).",
    market:"Buy or sell eFootball accounts. GAME BOI does not hold your money, so check the seller and agree the details before you pay.",
    leaderboard:"Points come only from match results that both players have confirmed.",
    clans:"Team up with friends. Join a clan, or start your own.",
    payments:"Your entry-fee payments. “Pending” means we are still waiting for you to approve on your phone.",
    notifications:"Updates about your tournaments, payments and matches."
  };
  var pending=false;
  function decorate(){
    var seg=(location.hash||"").replace(/^#\/?/,"").split("?")[0].split("/")[0];
    var h1=app.querySelector("h1");
    if(h1&&HELP[seg]&&!app.querySelector(".help")){
      var p=document.createElement("p");p.className="help";p.textContent=HELP[seg];
      h1.insertAdjacentElement("afterend",p);
    }
    var reg=app.querySelector("#reg"),cta=app.querySelector(".cta");
    if(reg&&cta&&!app.querySelector(".howjoin")){
      var paid=Number(reg.dataset.fee)>0;
      var d=document.createElement("div");d.className="howjoin";
      d.innerHTML=paid
        ?"<b>How to join</b><span><i>1</i>Tap the green button</span><span><i>2</i>Pick Orange Money or Afrimoney</span><span><i>3</i>Dial the code and enter your PIN</span>"
        :"<b>How to join</b><span><i>1</i>Tap Register. It is free.</span>";
      cta.parentNode.insertBefore(d,cta);
    }
  }
  new MutationObserver(function(){
    if(pending)return;pending=true;
    requestAnimationFrame(function(){pending=false;decorate()});
  }).observe(app,{childList:true});
  decorate();
})();
