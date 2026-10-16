import { Instrument, cycle, HARMONICS } from './model.js';
import { analyze, vowel } from './analysis.js';
import { AudioEngine } from './audio.js';
import { initDSP } from './dsp.js';
try { await initDSP(); }
catch (error) {
  document.getElementById('status').textContent = error.message;
  document.querySelectorAll('button,input').forEach(control => control.disabled = true);
  throw error;
}
const $ = id => document.getElementById(id);
const model = new Instrument(), audio = new AudioEngine(), locks = new Set();
let target = vowel('oo'), pitch = 196, training = false, busy = false, recorded = null, audition = null, auditionTimer, epoch = 0;
let baseline = 1, currentLoss = 1;
const sliders = [], markers = [];
const noteName = frequency => {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
};
function status(message) { $('status').textContent = message; }
function stopAudition() {
  clearTimeout(auditionTimer); audio.stop('audition'); audio.stopRecording(); audition = null;
  for (const [kind,label] of [['target','Listen to target'],['synth','Listen to synth'],['original','Original recording']]) {
    $(`listen-${kind}`).classList.remove('active'); $(`listen-${kind}`).textContent = `▷ ${label}`;
  }
}
function silence() { epoch++; stopAudition(); audio.stopAll(); document.querySelectorAll('.key.active').forEach(key => key.classList.remove('active')); }
function setTraining(value) {
  training = value;
  $('train').innerHTML = value ? 'Pause learning <span>Ⅱ</span>' : 'Teach the synth <span>→</span>';
}
function setTarget(amplitudes, frequency, name) {
  silence(); setTraining(false); target = amplitudes; pitch = frequency;
  model.setTarget(target); currentLoss = model.evaluate().loss;
  baseline = Math.max(cycle(target).reduce((sum, n) => sum + n*n, 0) / 128, 1e-8);
  $('source-name').textContent = name; $('pitch').textContent = `${Math.round(pitch)} Hz · ${noteName(pitch)}`;
  for (let i = 0; i < HARMONICS; i++) markers[i].style.bottom = `${target[i] * 100}%`;
  sync();
}
for (let h = 0; h < HARMONICS; h++) {
  const column = document.createElement('div'); column.className = 'harmonic';
  column.innerHTML = `<div class="fader"><span class="marker"></span><input type="range" aria-label="Harmonic ${h+1} amplitude" min="0" max="1" step="0.001" value="0"></div><button aria-label="Lock harmonic ${h+1}" aria-pressed="false" title="Lock harmonic ${h+1}">${String(h+1).padStart(2,'0')}</button>`;
  const slider = column.querySelector('input'), lock = column.querySelector('button');
  slider.addEventListener('input', () => { setTraining(false); model.weights[h] = Number(slider.value); status('Your edit is live. Teach again to keep exploring.'); sync(); });
  lock.addEventListener('click', () => { locks.has(h) ? locks.delete(h) : locks.add(h); lock.setAttribute('aria-pressed', String(locks.has(h))); lock.setAttribute('aria-label', `${locks.has(h) ? 'Unlock' : 'Lock'} harmonic ${h+1}`); status(locks.size ? `${locks.size} harmonic${locks.size > 1 ? 's' : ''} locked. Learning will leave those controls in place.` : 'All harmonics are free to learn.'); });
  sliders.push(slider); markers.push(column.querySelector('.marker')); $('harmonics').append(column);
}
function draw(waveform) {
  const canvas = $('scope'), ctx = canvas.getContext('2d'), box = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(dpr,0,0,dpr,0,0); const w = box.width, h = box.height;
  ctx.clearRect(0,0,w,h); ctx.strokeStyle = '#373e35'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w/12) { ctx.beginPath(); ctx.moveTo(x,15); ctx.lineTo(x,h-15); ctx.stroke(); }
  for (let y = 20; y < h-10; y += (h-40)/4) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  const targetWave = cycle(target), peak = Math.max(1, ...targetWave.map(Math.abs), ...waveform.map(Math.abs));
  for (const [data,color,lineWidth] of [[targetWave,'#77816d',1.5],[waveform,'#d4ed9e',2]]) {
    ctx.beginPath(); ctx.lineWidth = lineWidth; ctx.strokeStyle = color;
    for (let i=0;i<=128;i++) { const x = i/128*w, y = h/2 - data[i%128]/peak*(h*.34); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }
    ctx.stroke();
  }
}
function sync() {
  const result = model.evaluate(); currentLoss = result.loss;
  const fit = Math.max(0, Math.min(100, 100 * (1 - Math.sqrt(currentLoss / baseline))));
  $('fit').textContent = `${fit.toFixed(1)}%`; $('progress-fill').style.width = `${fit}%`; $('steps').textContent = model.steps.toLocaleString();
  sliders.forEach((slider,h) => { if (document.activeElement !== slider) slider.value = model.weights[h]; });
  draw(result.waveform);
  if (audition !== 'target') audio.update(model.weights);
}
let previousTick = 0;
function frame(time) {
  if (training && time-previousTick > 30) {
    previousTick = time;
    for (let step=0;step<2;step++) model.train(locks);
    sync();
    if (model.steps >= 260 || currentLoss / baseline < .000001) {
      setTraining(false);
      status(locks.size && currentLoss/baseline > .0001 ? 'Fit complete with your locked harmonics. Unlock them for a closer match.' : 'Your instrument is ready. Play a few notes below.');
    }
  }
  requestAnimationFrame(frame);
}
$('train').addEventListener('click', () => {
  if (locks.size === HARMONICS) { status('All harmonics are locked. Unlock at least one to teach the synth.'); return; }
  if (!training) model.steps = 0;
  setTraining(!training);
  if (training) {
    listen('synth', { toggle:false, durationMs:8000 });
    status('Listen as the synth learns your target. The piano plays this evolving sound.');
  } else { stopAudition(); status('Learning paused. Play the current sound, or keep teaching.'); }
});
$('reset').addEventListener('click', () => { setTraining(false); model.reset(); sync(); status('Back to a simple tone. Your target and locks are kept.'); });
document.querySelectorAll('[data-vowel]').forEach(button => button.addEventListener('click', () => {
  if (busy) return; recorded = null; $('listen-original').hidden = true;
  document.querySelectorAll('[data-vowel]').forEach(other => { other.classList.toggle('selected', other===button); other.setAttribute('aria-pressed', String(other===button)); });
  setTarget(vowel(button.dataset.vowel), 196, `SYNTHETIC / ${button.dataset.vowel.toUpperCase()}${button.dataset.vowel[0].toUpperCase()}`);
  listen('target', { toggle:false });
  status(`Previewing “${button.dataset.vowel}${button.dataset.vowel[0]}”. Press Teach to hear your synth learn this sound.`);
}));
$('record').addEventListener('click', async () => {
  if (busy) return;
  busy = true; silence(); setTraining(false);
  const controls = document.querySelectorAll('#record, #train, #reset, [data-vowel], .listen-row button, #save');
  controls.forEach(button => button.disabled = true);
  $('record-text').textContent = 'Waiting for microphone…'; status('Allow microphone access, then hold one comfortable note.');
  try {
    const recording = await audio.record(() => { $('record').classList.add('recording'); $('record-text').textContent = 'Listening… hold your note'; status('Listening for 2 seconds. Hold a steady vowel.'); });
    $('record-text').textContent = 'Finding your sound…';
    const result = analyze(recording.samples, recording.sampleRate);
    recorded = recording;
    setTarget(result.amplitudes, result.pitch, 'YOUR VOICE / CAPTURED');
    document.querySelectorAll('[data-vowel]').forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed','false'); });
    $('listen-original').hidden = false;
    status('Got your note. Teach the synth to approximate its harmonic character.');
  } catch (error) {
    status(error.name === 'NotAllowedError' ? 'Microphone access wasn’t granted. Try a sample, or allow access in your browser and record again.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect one, or try a sample sound.' : error.message);
  } finally { busy = false; controls.forEach(button => button.disabled = false); $('record-text').textContent = 'Record your voice'; $('record').classList.remove('recording'); }
});
async function listen(kind, { toggle = true, durationMs = 3000 } = {}) {
  if (busy) return;
  const was = audition; silence(); if (toggle && was === kind) return;
  const ticket = epoch;
  try {
    await audio.ready(); if (epoch !== ticket) return;
    audition = kind; $(`listen-${kind}`).classList.add('active');
    $(`listen-${kind}`).textContent = `■ Playing ${kind === 'original' ? 'recording' : kind} · stop`;
    if (kind === 'original' && recorded) await audio.playRecording(recorded.samples, recorded.sampleRate);
    else audio.note('audition', pitch, kind === 'target' ? target : model.weights);
    auditionTimer = setTimeout(stopAudition, kind === 'original' ? 2100 : durationMs);
  } catch (error) { status(`Audio couldn’t start: ${error.message}`); stopAudition(); }
}
for (const kind of ['target','synth','original']) $(`listen-${kind}`).addEventListener('click', () => listen(kind));
const notes = [{s:0,k:'a'},{s:1,k:'w',black:true,left:9},{s:2,k:'s'},{s:3,k:'e',black:true,left:21.5},{s:4,k:'d'},{s:5,k:'f'},{s:6,k:'t',black:true,left:46.5},{s:7,k:'g'},{s:8,k:'y',black:true,left:59},{s:9,k:'h'},{s:10,k:'u',black:true,left:71.5},{s:11,k:'j'},{s:12,k:'k'}];
const held = new Set(), keyElements = new Map();
async function startNote(note, id) {
  if (busy || held.has(id)) return; held.add(id);
  const ticket = epoch;
  try {
    await audio.ready(); if (!held.has(id) || ticket !== epoch) return;
    stopAudition(); audio.note(id, 261.625565 * 2 ** (note.s/12), model.weights); keyElements.get(note.k).classList.add('active');
  } catch (error) { held.delete(id); status(`Audio couldn’t start: ${error.message}`); }
}
function stopNote(note, id) { held.delete(id); audio.stop(id); keyElements.get(note.k).classList.remove('active'); }
for (const note of notes) {
  const button = document.createElement('button'); button.className = `key ${note.black ? 'black':'white'}`;
  if (note.black) button.style.left = `${note.left}%`;
  const name = noteName(261.625565 * 2 ** (note.s/12));
  button.setAttribute('aria-label', `Play ${name}, keyboard ${note.k.toUpperCase()}`);
  button.innerHTML = `<span class="note-name">${name}</span><span>${note.k.toUpperCase()}</span>`;
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); startNote(note, `pointer-${event.pointerId}`); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type, event => stopNote(note, `pointer-${event.pointerId}`));
  button.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); startNote(note, `accessible-${note.k}`); } });
  button.addEventListener('keyup', event => { if (['Enter',' '].includes(event.key)) stopNote(note, `accessible-${note.k}`); });
  button.addEventListener('blur', () => stopNote(note, `accessible-${note.k}`));
  keyElements.set(note.k,button); $('keyboard').append(button);
}
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return;
  const note = notes.find(note => note.k === event.key.toLowerCase()); if (note) { event.preventDefault(); startNote(note, `keyboard-${note.k}`); }
});
window.addEventListener('keyup', event => { const note = notes.find(note => note.k === event.key.toLowerCase()); if (note) stopNote(note, `keyboard-${note.k}`); });
window.addEventListener('blur', () => { held.clear(); silence(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { held.clear(); silence(); setTraining(false); } });
$('volume').addEventListener('input', event => audio.volume(Number(event.target.value)));
$('save').addEventListener('click', () => {
  const data = { format:'voice-tuner/v1', harmonics:Array.from(model.weights), sourcePitchHz:pitch, source:$('source-name').textContent, lockedHarmonics:Array.from(locks, h => h+1) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{ type:'application/json' }));
  const a = document.createElement('a'); a.href=url; a.download='my-voice-instrument.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  status('Saved your harmonic recipe. Your recording is not included.');
});
new ResizeObserver(() => draw(model.evaluate().waveform)).observe($('scope'));
setTarget(target,pitch,'SYNTHETIC / OOO'); requestAnimationFrame(frame);
