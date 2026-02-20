/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */

function showToast(m) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function fmt(s) {
  return Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');
}

/* ═══════════════════════════════════
   AUDIO STATE
═══════════════════════════════════ */
let audioBuffer = null;
let audioCtx    = null;
let srcNode     = null;
let isPlaying   = false;
let startTime   = 0;
let pauseOffset = 0;
let progTimer   = null;

/* ═══════════════════════════════════
   LOAD AUDIO ON PAGE READY
═══════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  const fname = sessionStorage.getItem('cs_filename') || 'audio file';
  document.getElementById('fnameDisplay').textContent = fname;

  const b64 = sessionStorage.getItem('cs_audio_b64');

  if (!b64) {
    document.getElementById('loader').classList.add('done');
    document.getElementById('mainPage').style.opacity = '1';
    showToast('No audio found — please upload a file first.');
    loadDemoMode();
    return;
  }

  try {
    const resp = await fetch(b64);
    const ab   = await resp.arrayBuffer();
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await audioCtx.decodeAudioData(ab);
    onAudioReady();
  } catch (e) {
    document.getElementById('loader').classList.add('done');
    document.getElementById('mainPage').style.opacity = '1';
    showToast('Error loading audio. Please re-upload.');
    loadDemoMode();
  }
});

/* ═══════════════════════════════════
   AUDIO READY → ANALYZE + DRAW
═══════════════════════════════════ */
function onAudioReady() {
  document.getElementById('wDur').textContent = audioBuffer.duration.toFixed(2) + 's';
  document.getElementById('wSr').textContent  = (audioBuffer.sampleRate / 1000).toFixed(1) + ' kHz';
  document.getElementById('wCh').textContent  = audioBuffer.numberOfChannels;
  document.getElementById('pbTot').textContent = fmt(audioBuffer.duration);

  const results = analyzeAudio(audioBuffer);
  populateUI(results);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawWaveform(audioBuffer);
    document.getElementById('loader').classList.add('done');
    document.getElementById('mainPage').style.opacity = '1';
  }));
}

/* ═══════════════════════════════════
   AUDIO ANALYSIS ENGINE
═══════════════════════════════════ */
function analyzeAudio(buf) {
  const data = buf.getChannelData(0);
  const sr   = buf.sampleRate;
  const dur  = buf.duration;

  /* — Energy envelope (25ms frames) — */
  const fs  = Math.floor(sr * 0.025);
  const env = [];
  for (let i = 0; i < data.length - fs; i += fs) {
    let e = 0;
    for (let j = 0; j < fs; j++) e += data[i + j] * data[i + j];
    env.push(Math.sqrt(e / fs));
  }

  const envMean = env.reduce((a, b) => a + b, 0) / env.length;
  const envMax  = Math.max(...env);

  /* — Peak detection — */
  const threshold = envMean * 1.5;
  const minGap    = Math.floor(sr * 0.25 / fs);
  const peaks     = [];

  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > threshold && env[i] > env[i - 1] && env[i] > env[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] > minGap) {
        peaks.push(i);
      }
    }
  }

  /* — BPM from inter-peak intervals — */
  let bpm = null, avgInterval = null, intervalCV = null;
  if (peaks.length >= 2) {
    const ivls    = peaks.slice(1).map((p, i) => (p - peaks[i]) * fs / sr);
    avgInterval   = ivls.reduce((a, b) => a + b, 0) / ivls.length;
    bpm           = Math.round(60 / avgInterval);
    bpm           = Math.max(30, Math.min(220, bpm));
    const variance = ivls.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) / ivls.length;
    intervalCV    = Math.sqrt(variance) / avgInterval;
  }

  /* — Rhythm classification — */
  let rhythm = 'Insufficient data', rhythmAssess = 'Requires more data';
  if (intervalCV !== null) {
    if (intervalCV < 0.08) {
      rhythm = 'Regular Sinus';
      rhythmAssess = 'Normal cardiac rhythm';
    } else if (intervalCV < 0.20) {
      rhythm = 'Mildly Irregular';
      rhythmAssess = 'Slight irregularity detected';
    } else {
      rhythm = 'Irregular';
      rhythmAssess = 'Significant irregularity — consult clinician';
    }
  }

  /* — Band power (energy per frequency range) — */
  function bandPower(lo, hi) {
    const spf = Math.floor(sr / ((lo + hi) / 2));
    let power = 0, count = 0;
    for (let i = 0; i < data.length - spf; i += spf) {
      let e = 0;
      for (let j = 0; j < spf; j++) e += data[i + j] * data[i + j];
      power += e / spf;
      count++;
    }
    return count > 0 ? power / count : 0;
  }

  const b1 = bandPower(5, 50);
  const b2 = bandPower(50, 150);
  const b3 = bandPower(150, 300);
  const b4 = bandPower(300, 1000);
  const bTotal = b1 + b2 + b3 + b4 || 1;

  /* — Dominant frequency via zero-crossings — */
  let zc = 0;
  const cap = Math.min(data.length, sr * Math.min(dur, 10));
  for (let i = 1; i < cap; i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) zc++;
  }
  const domFreq = Math.round(zc / (2 * Math.min(dur, 10)));

  return {
    bpm, dur, sr: buf.sampleRate, ch: buf.numberOfChannels,
    peaks: peaks.length, avgInterval, intervalCV,
    rhythm, rhythmAssess,
    domFreq, zc,
    bands: [b1 / bTotal, b2 / bTotal, b3 / bTotal, b4 / bTotal],
    envMax
  };
}

/* ═══════════════════════════════════
   POPULATE UI WITH RESULTS
═══════════════════════════════════ */
function populateUI(r) {

  /* — Status bar — */
  if (r.bpm) {
    const isNormal = r.bpm >= 60 && r.bpm <= 100;
    const isBrady  = r.bpm < 60;
    const cls      = isNormal ? 'good' : isBrady ? 'warn' : 'bad';

    document.getElementById('sbBpm').textContent = r.bpm;
    document.getElementById('sbBpm').className   = 'status-value ' + cls;
    document.getElementById('sbBpmSub').textContent =
      isNormal ? '✓ Normal range (60–100 BPM)' :
      isBrady  ? '⚠ Bradycardia (<60 BPM)' :
                 '⚠ Tachycardia (>100 BPM)';

    const pct = Math.min(Math.max((r.bpm - 30) / (200 - 30) * 100, 2), 98);
    document.getElementById('sbBpmBar').style.width      = pct + '%';
    document.getElementById('sbBpmBar').style.background = isNormal ? '#0f766e' : isBrady ? '#b45309' : '#c0392b';

    /* — Big BPM gauge — */
    document.getElementById('bigBpm').textContent  = r.bpm;
    document.getElementById('bigBpm').style.color  = isNormal ? '#0f766e' : isBrady ? '#b45309' : '#c0392b';

    const bcEl = document.getElementById('bpmClass');
    if (isNormal)     { bcEl.textContent = 'Normal Sinus'; bcEl.className = 'bpm-class normal'; }
    else if (isBrady) { bcEl.textContent = 'Bradycardia';  bcEl.className = 'bpm-class brady'; }
    else              { bcEl.textContent = 'Tachycardia';  bcEl.className = 'bpm-class tachy'; }

    document.getElementById('rangeNeedle').style.left = pct + '%';
  } else {
    document.getElementById('sbBpm').textContent  = 'N/A';
    document.getElementById('bigBpm').textContent = 'N/A';
  }

  document.getElementById('sbRhythm').textContent = r.rhythm;
  document.getElementById('sbRhythm').className   = 'status-value sm' +
    (r.rhythm === 'Regular Sinus' ? ' good' : r.rhythm === 'Mildly Irregular' ? ' warn' : ' bad');

  document.getElementById('sbFreq').textContent  = r.domFreq + ' Hz';
  document.getElementById('sbPeaks').textContent = r.peaks + ' peaks';

  /* — Rhythm detail card — */
  document.getElementById('rRhythm').textContent   = r.rhythm;
  document.getElementById('rInterval').textContent = r.avgInterval ? (r.avgInterval * 1000).toFixed(0) + ' ms' : '—';
  document.getElementById('rCV').textContent       = r.intervalCV  ? (r.intervalCV * 100).toFixed(1) + '%' : '—';
  document.getElementById('rCV').className         = 'ri-val' +
    (r.intervalCV < 0.08 ? ' good' : r.intervalCV < 0.20 ? ' warn' : '');
  document.getElementById('rPeaks').textContent    = r.peaks + ' events';
  document.getElementById('rDur').textContent      = r.dur.toFixed(1) + 's';
  document.getElementById('rAssess').textContent   = r.rhythmAssess;
  document.getElementById('rAssess').className     = 'ri-val' +
    (r.rhythm === 'Regular Sinus' ? ' good' : r.rhythm === 'Mildly Irregular' ? ' warn' : '');

  /* — Frequency bands — */
  const bandIds = ['fq1', 'fq2', 'fq3', 'fq4'];
  const valIds  = ['fq1v', 'fq2v', 'fq3v', 'fq4v'];
  r.bands.forEach((b, i) => {
    document.getElementById(bandIds[i]).style.width    = (b * 100).toFixed(1) + '%';
    document.getElementById(valIds[i]).textContent     = (b * 100).toFixed(0) + '%';
  });
  document.getElementById('rFreq').textContent = r.domFreq + ' Hz';
  document.getElementById('rZC').textContent   = r.zc.toLocaleString();

  /* — Clinical notes — */
  const notes = [];
  if (r.bpm && r.bpm >= 60 && r.bpm <= 100)
    notes.push({ icon: '✅', text: 'Heart rate is within the normal sinus range of 60–100 BPM.' });
  if (r.bpm && r.bpm < 60)
    notes.push({ icon: '⚠️', text: 'Detected heart rate suggests bradycardia (<60 BPM). This can be normal in trained athletes but warrants clinical review.' });
  if (r.bpm && r.bpm > 100)
    notes.push({ icon: '⚠️', text: 'Detected heart rate suggests tachycardia (>100 BPM). May indicate stress, fever, or cardiac arrhythmia. Clinical evaluation recommended.' });
  if (r.rhythm === 'Regular Sinus')
    notes.push({ icon: '✅', text: 'Rhythm appears regular with low interval variability — consistent with normal sinus rhythm.' });
  if (r.rhythm === 'Mildly Irregular')
    notes.push({ icon: '🔶', text: 'Mild rhythm irregularity detected. May be respiratory sinus arrhythmia (physiologically normal) or an early arrhythmia. Correlate with clinical findings.' });
  if (r.rhythm === 'Irregular')
    notes.push({ icon: '⚠️', text: 'Significant rhythm irregularity detected. Differential includes atrial fibrillation, ectopic beats, or other arrhythmias. Clinical evaluation advised.' });
  if (r.domFreq > 200)
    notes.push({ icon: '🔬', text: 'High dominant frequency detected. This may indicate background noise or electronic interference in the recording.' });
  if (r.dur < 10)
    notes.push({ icon: '💡', text: 'Recording duration is short. Longer recordings (>30s) improve BPM detection accuracy significantly.' });
  if (r.peaks < 3)
    notes.push({ icon: '💡', text: 'Few cardiac events detected. Ensure the recording microphone was placed close to the chest wall, and the environment was quiet.' });

  const nl = document.getElementById('notesList');
  nl.innerHTML = notes
    .map(n => `<div class="note-item"><div class="note-icon">${n.icon}</div><div>${n.text}</div></div>`)
    .join('');
}

/* ═══════════════════════════════════
   WAVEFORM CANVAS DRAWING
═══════════════════════════════════ */
function drawWaveform(buf) {
  const canvas = document.getElementById('waveCanvas');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  let W = canvas.parentElement.clientWidth || 900;
  if (W < 100) W = 900;
  const H   = 220;
  const mid = H / 2;

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  const raw  = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(raw.length / W));

  /* — Background — */
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, W, H);

  /* — Horizontal grid lines — */
  ctx.strokeStyle = 'rgba(215,210,200,0.6)';
  ctx.lineWidth   = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (H / 8) * i);
    ctx.lineTo(W, (H / 8) * i);
    ctx.stroke();
  }

  /* — Vertical time-marker lines — */
  ctx.strokeStyle = 'rgba(215,210,200,0.4)';
  const timeStep  = Math.floor(W / 10);
  for (let i = 1; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(timeStep * i, 0);
    ctx.lineTo(timeStep * i, H);
    ctx.stroke();
  }

  /* — Time axis labels — */
  ctx.fillStyle  = '#c8c4be';
  ctx.font       = '10px Plus Jakarta Sans';
  ctx.textAlign  = 'center';
  for (let i = 0; i <= 10; i++) {
    const t = (buf.duration * i / 10).toFixed(1);
    ctx.fillText(t + 's', timeStep * i, H - 4);
  }

  /* — Amplitude labels — */
  ctx.textAlign  = 'left';
  ctx.font       = '10px Plus Jakarta Sans';
  ctx.fillStyle  = '#c8c4be';
  ctx.fillText('+1.0', 4, 14);
  ctx.fillText(' 0',   4, mid + 4);
  ctx.fillText('-1.0', 4, H - 16);

  /* — Build per-pixel min/max arrays — */
  const maxArr = new Float32Array(W);
  const minArr = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let mn = 1, mx = -1;
    const start = x * step;
    const end   = Math.min(start + step, raw.length);
    for (let j = start; j < end; j++) {
      const v = raw[j] || 0;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    maxArr[x] = mx;
    minArr[x] = mn;
  }

  /* — Filled waveform body — */
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (let x = 0; x < W; x++) ctx.lineTo(x, mid - maxArr[x] * mid * 0.88);
  for (let x = W - 1; x >= 0; x--) ctx.lineTo(x, mid - minArr[x] * mid * 0.88);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   'rgba(192,57,43,0.22)');
  grad.addColorStop(0.5, 'rgba(192,57,43,0.06)');
  grad.addColorStop(1,   'rgba(192,57,43,0.22)');
  ctx.fillStyle = grad;
  ctx.fill();

  /* — Top envelope line (peaks) — */
  ctx.beginPath();
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth   = 1.8;
  ctx.lineJoin    = 'round';
  for (let x = 0; x < W; x++) {
    if (x === 0) ctx.moveTo(0, mid - maxArr[0] * mid * 0.88);
    else         ctx.lineTo(x, mid - maxArr[x] * mid * 0.88);
  }
  ctx.stroke();

  /* — Bottom envelope line (troughs) — */
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(192,57,43,0.45)';
  ctx.lineWidth   = 1.2;
  for (let x = 0; x < W; x++) {
    if (x === 0) ctx.moveTo(0, mid - minArr[0] * mid * 0.88);
    else         ctx.lineTo(x, mid - minArr[x] * mid * 0.88);
  }
  ctx.stroke();

  /* — Zero-line dashed — */
  ctx.strokeStyle = 'rgba(192,57,43,0.2)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ═══════════════════════════════════
   DEMO MODE (no audio loaded)
═══════════════════════════════════ */
function loadDemoMode() {
  document.getElementById('wDur').textContent = '—';
  document.getElementById('wSr').textContent  = '—';
  document.getElementById('wCh').textContent  = '—';
  document.getElementById('pbTot').textContent = '0:00';

  const canvas = document.getElementById('waveCanvas');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  let W = canvas.parentElement.clientWidth || 900;
  const H = 220;

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle  = '#c8c4be';
  ctx.font       = '16px Plus Jakarta Sans';
  ctx.textAlign  = 'center';
  ctx.fillText('No audio uploaded — please go back and upload a file.', W / 2, H / 2);

  document.getElementById('notesList').innerHTML =
    '<div class="note-item"><div class="note-icon">💡</div>' +
    '<div>No audio was found. Please <a href="analyzer.html" style="color:var(--olive);font-weight:700;">go back and upload a file</a> to see your analysis.</div></div>';
}

/* ═══════════════════════════════════
   PLAYBACK CONTROLS
═══════════════════════════════════ */
function handlePlay() {
  if (!audioBuffer || isPlaying) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  srcNode = audioCtx.createBufferSource();
  srcNode.buffer = audioBuffer;
  srcNode.connect(audioCtx.destination);
  srcNode.start(0, pauseOffset);
  startTime = audioCtx.currentTime - pauseOffset;
  isPlaying = true;

  document.getElementById('btnPlay').style.display  = 'none';
  document.getElementById('btnPause').style.display = 'flex';
  document.getElementById('btnPause').classList.add('active');

  srcNode.onended = () => {
    if (!isPlaying) return;
    isPlaying   = false;
    pauseOffset = 0;
    document.getElementById('btnPlay').style.display  = 'flex';
    document.getElementById('btnPause').style.display = 'none';
    document.getElementById('btnPause').classList.remove('active');
    document.getElementById('pbFill').style.width     = '0%';
    document.getElementById('pbCur').textContent      = '0:00';
    clearInterval(progTimer);
  };

  clearInterval(progTimer);
  progTimer = setInterval(() => {
    if (!isPlaying) return;
    const elapsed = audioCtx.currentTime - startTime;
    document.getElementById('pbFill').style.width = Math.min(elapsed / audioBuffer.duration * 100, 100) + '%';
    document.getElementById('pbCur').textContent  = fmt(elapsed);
  }, 100);
}

function handlePause() {
  if (!isPlaying) return;
  pauseOffset = audioCtx.currentTime - startTime;
  srcNode.stop();
  isPlaying = false;
  clearInterval(progTimer);
  document.getElementById('btnPlay').style.display  = 'flex';
  document.getElementById('btnPause').style.display = 'none';
  document.getElementById('btnPause').classList.remove('active');
}

function handleStop() {
  if (srcNode) { try { srcNode.stop(); } catch (e) {} }
  isPlaying   = false;
  pauseOffset = 0;
  clearInterval(progTimer);
  document.getElementById('btnPlay').style.display  = 'flex';
  document.getElementById('btnPause').style.display = 'none';
  document.getElementById('btnPause').classList.remove('active');
  document.getElementById('pbFill').style.width     = '0%';
  document.getElementById('pbCur').textContent      = '0:00';
}

function seekAudio(e) {
  if (!audioBuffer) return;
  const rect = document.getElementById('pbTrack').getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  pauseOffset = pct * audioBuffer.duration;
  const was  = isPlaying;
  if (isPlaying) { srcNode.stop(); isPlaying = false; clearInterval(progTimer); }
  document.getElementById('pbFill').style.width     = (pct * 100) + '%';
  document.getElementById('pbCur').textContent      = fmt(pauseOffset);
  document.getElementById('btnPlay').style.display  = 'flex';
  document.getElementById('btnPause').style.display = 'none';
  document.getElementById('btnPause').classList.remove('active');
  if (was) handlePlay();
}

/* Redraw on resize */
window.addEventListener('resize', () => {
  if (audioBuffer) drawWaveform(audioBuffer);
});

/* ═══════════════════════════════════
   EXPORT REPORT
═══════════════════════════════════ */
function exportReport() {
  const fname    = document.getElementById('fnameDisplay').textContent;
  const bpm      = document.getElementById('sbBpm').textContent;
  const rhythm   = document.getElementById('sbRhythm').textContent;
  const freq     = document.getElementById('sbFreq').textContent;
  const peaks    = document.getElementById('sbPeaks').textContent;
  const interval = document.getElementById('rInterval').textContent;
  const cv       = document.getElementById('rCV').textContent;
  const assess   = document.getElementById('rAssess').textContent;
  const now      = new Date().toLocaleString();
  const notes    = Array.from(document.querySelectorAll('.note-item'))
                       .map(n => n.textContent.trim())
                       .join('\n• ');

  const report = `CARDIOSPECTRA — CARDIAC ANALYSIS REPORT
=========================================
Generated: ${now}
File: ${fname}

VITALS SUMMARY
--------------
Heart Rate:         ${bpm} BPM
Rhythm:             ${rhythm}
Dominant Frequency: ${freq}
Events Detected:    ${peaks}

RHYTHM DETAIL
-------------
Avg Beat Interval:  ${interval}
Interval CV:        ${cv}
Assessment:         ${assess}

CLINICAL OBSERVATIONS
---------------------
• ${notes}

=========================================
DISCLAIMER: This report is generated by signal processing algorithms for educational
and screening purposes only. It does not constitute medical advice. Consult a qualified
cardiologist for clinical interpretation.

CardioSpectra v2.0 | Open Source | Built for Primary Healthcare Access
`;

  const blob = new Blob([report], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'CardioSpectra_Report_' + Date.now() + '.txt';
  a.click();
  showToast('Report exported!');
}
