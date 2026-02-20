function handleFile(file){
  if(!file) return;
  alert('Loaded: ' + file.name);
}

function showMic(){
  document.getElementById('micSection').classList.add('active');
}

let analyser = null;

async function toggleMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    src.connect(analyser);
    document.getElementById('micStat').textContent = 'Recording...';
    drawMic();
  }catch(e){
    alert('Mic permission denied');
  }
}

function drawMic(){
  const canvas = document.getElementById('micCanvas');
  const ctx = canvas.getContext('2d');
  const data = new Float32Array(1024);

  function loop(){
    requestAnimationFrame(loop);
    if(!analyser) return;

    analyser.getFloatTimeDomainData(data);

    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath();

    for(let i=0;i<data.length;i++){
      const x = i*(canvas.width/data.length);
      const y = 75 + data[i]*60;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }

    ctx.strokeStyle = '#c0392b';
    ctx.stroke();
  }
  loop();
}
