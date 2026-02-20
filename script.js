(function(){

  const canvas = document.getElementById('heroCanvas');
  if(!canvas) return;

  const ctx = canvas.getContext('2d');
  let W = 0;
  const H = 160;
  let data = [];
  const SPEED = 2.2;

  function resize(){
    W = canvas.parentElement.clientWidth;
    canvas.width = W;
    canvas.height = H;
    data = new Array(W).fill(H/2);
  }

  function beatY(t){
    const m = H/2;
    if(t<0.3) return m;
    if(t<0.4) return m-50*Math.sin((t-0.3)*Math.PI*5);
    return m;
  }

  let ph=0;
  const BEAT=125;
  const PAUSE=60;

  function draw(){
    requestAnimationFrame(draw);

    for(let s=0;s<SPEED;s++){
      let y;
      if(ph<BEAT){ y=beatY(ph/BEAT); ph++; }
      else if(ph<BEAT+PAUSE){ y=H/2; ph++; }
      else{ ph=0; y=H/2; }

      data.push(y);
      if(data.length>W) data.shift();
    }

    ctx.clearRect(0,0,W,H);

    ctx.beginPath();
    data.forEach((v,i)=>{
      if(i===0) ctx.moveTo(i,v);
      else ctx.lineTo(i,v);
    });

    ctx.strokeStyle="#c0392b";
    ctx.lineWidth=2;
    ctx.stroke();
  }

  resize();
  draw();

  window.addEventListener("resize",resize);

  setInterval(()=>{
    document.getElementById("bpmDisp").textContent =
      68+Math.floor(Math.random()*10);

    document.getElementById("prDisp").textContent =
      150+Math.floor(Math.random()*30);
  },2000);

})();
