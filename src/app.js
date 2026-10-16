import { Instrument, cycle, HARMONICS, SAMPLES } from './model.js';
import { analyze, vowel } from './analysis.js';
import { AudioEngine } from './audio.js';
import { initDSP } from './dsp.js';
import { keyboardLayout, typedNote, pianoNoteName } from './keyboard-layout.js';
import { encodeWav } from './voice-sample.js';
try { await initDSP(); }
catch (error) {
  document.getElementById('status').textContent = error.message;
  document.querySelectorAll('button,input').forEach(control => control.disabled = true);
  throw error;
}
const $ = id => document.getElementById(id);
const model = new Instrument(), audio = new AudioEngine(), locks = new Set();
let target = vowel('oo'), pitch = 196, training = false, busy = false, recorded = null, audition = null, auditionTimer, epoch = 0;
let baseline = 1, currentLoss = 1, playbackMode = 'synth';
const sliders = [], markers = [];
const held = new Map(), keyElements = new Map(), guideElements = new Map();
const noteName = frequency => {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
};
function status(message) { $('status').textContent = message; }
function captureStatus(message, error = false) {
  $('capture-status').textContent = message;
  $('capture-status').classList.toggle('error', error);
}
function stopAudition() {
  clearTimeout(auditionTimer); audio.stop('audition'); audio.stopRecording(); audition = null;
  for (const [kind,label] of [['target','Hear target tone'],['synth','Hear learned synth'],['original','Original recording'],['voice','Hear voice instrument']]) {
    $(`listen-${kind}`).classList.remove('active'); $(`listen-${kind}`).textContent = `▷ ${label}`;
  }
}
function silence() { epoch++; held.clear(); stopAudition(); audio.stopAll(); document.querySelectorAll('.key.active, .typing-guide-key.active').forEach(key => key.classList.remove('active')); }
function updatePlaybackUI() {
  $('mode-voice').disabled = !recorded || busy;
  $('mode-synth').disabled = busy;
  $('mode-voice').setAttribute('aria-pressed', String(playbackMode === 'voice'));
  $('mode-synth').setAttribute('aria-pressed', String(playbackMode === 'synth'));
  $('voice-preview').hidden = !recorded || playbackMode !== 'voice';
  $('mode-help').textContent = playbackMode === 'voice'
    ? 'Your recorded texture, automatically tuned and played at each key’s pitch. Farther from your sung note, the voice’s color changes too.'
    : 'Handwired’s learned harmonic approximation. This mode leaves out the recording’s breath, phase, and changing texture.';
  $('play-hint').textContent = playbackMode === 'voice'
    ? 'Voice mode is ready. Play the piano or use your computer keyboard—no training is needed for this mode.'
    : training ? 'The synth is learning. Play the piano to hear it change.' : 'The piano plays the learned synth. Record a voice or train a sample to change its tone.';
  $('save').textContent = playbackMode === 'voice' ? '↓ Save voice sample' : '↓ Save synth recipe';
  if (recorded && audio.voiceSample) {
    $('voice-root').textContent = `Tuned to ${pianoNoteName(audio.voiceSample.rootMidi)} · ${Math.round(audio.voiceSample.rootFrequency)} Hz`;
    drawVoice();
  }
}
function setPlaybackMode(mode) {
  if (busy || (mode === 'voice' && !recorded)) return;
  silence(); playbackMode = mode; updatePlaybackUI();
}
function drawVoice() {
  if (!audio.voiceSample || $('voice-preview').hidden) return;
  const canvas = $('voice-scope'), box = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  canvas.width = Math.round(box.width*dpr); canvas.height = Math.round(box.height*dpr);
  const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  const data=audio.voiceSample.samples, length=Math.min(data.length,Math.round(audio.voiceSample.sampleRate*.04));
  let peak=.001; for(let i=0;i<length;i++) peak=Math.max(peak,Math.abs(data[i]));
  ctx.strokeStyle='#392c42'; ctx.lineWidth=1; ctx.beginPath();
  for(let x=0;x<Math.floor(box.width);x++) {
    const from=Math.floor(x/box.width*length), to=Math.max(from+1,Math.floor((x+1)/box.width*length));
    let low=1,high=-1; for(let i=from;i<to;i++){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}
    ctx.moveTo(x,box.height/2-low/peak*box.height*.42); ctx.lineTo(x,box.height/2-high/peak*box.height*.42);
  }
  ctx.stroke();
}
$('mode-voice').addEventListener('click',()=>setPlaybackMode('voice'));
$('mode-synth').addEventListener('click',()=>setPlaybackMode('synth'));
function setTraining(value) {
  training = value;
  $('learning-state').textContent = value ? 'Learning…' : 'Ready to train';
  $('learning-state').classList.toggle('learning', value);
  $('train').innerHTML = value ? 'Pause learning <span>Ⅱ</span>' : 'Train this sound <span>→</span>';
}
function setTarget(amplitudes, frequency, name) {
  silence(); setTraining(false); target = amplitudes; pitch = frequency;
  model.setTarget(target); currentLoss = model.evaluate().loss;
  baseline = Math.max(cycle(target).reduce((sum, n) => sum + n*n, 0) / SAMPLES, 1e-8);
  $('source-name').textContent = name; $('pitch').textContent = `${Math.round(pitch)} Hz · ${noteName(pitch)}`;
  for (let i = 0; i < HARMONICS; i++) markers[i].style.bottom = `${target[i] * 100}%`;
  $('play-hint').textContent = 'Train this sound to update the piano. Until then, it plays your current instrument.';
  sync();
}
for (let h = 0; h < HARMONICS; h++) {
  const column = document.createElement('div'); column.className = 'harmonic';
  column.innerHTML = `<div class="fader"><span class="marker"></span><input type="range" aria-label="Harmonic ${h+1} amplitude" min="0" max="1" step="0.001" value="0"></div><button aria-label="Lock harmonic ${h+1}" aria-pressed="false" title="Lock harmonic ${h+1}">${String(h+1).padStart(2,'0')}</button>`;
  const slider = column.querySelector('input'), lock = column.querySelector('button');
  slider.addEventListener('input', () => { setTraining(false); model.weights[h] = Number(slider.value); setPlaybackMode('synth'); status('Your edit is live. Teach again to keep exploring.'); sync(); });
  lock.addEventListener('click', () => { locks.has(h) ? locks.delete(h) : locks.add(h); lock.setAttribute('aria-pressed', String(locks.has(h))); lock.setAttribute('aria-label', `${locks.has(h) ? 'Unlock' : 'Lock'} harmonic ${h+1}`); status(locks.size ? `${locks.size} harmonic${locks.size > 1 ? 's' : ''} locked. Learning will leave those controls in place.` : 'All harmonics are free to learn.'); });
  sliders.push(slider); markers.push(column.querySelector('.marker')); $('harmonics').append(column);
}
function draw(waveform) {
  const canvas = $('scope'), ctx = canvas.getContext('2d'), box = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(dpr,0,0,dpr,0,0); const w = box.width, h = box.height;
  ctx.clearRect(0,0,w,h); ctx.strokeStyle = '#e2d8e8'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w/12) { ctx.beginPath(); ctx.moveTo(x,15); ctx.lineTo(x,h-15); ctx.stroke(); }
  for (let y = 20; y < h-10; y += (h-40)/4) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  const targetWave = cycle(target), peak = Math.max(1, ...targetWave.map(Math.abs), ...waveform.map(Math.abs));
  for (const [data,color,lineWidth] of [[targetWave,'#ac93bc',1.5],[waveform,'#392c42',2]]) {
    ctx.beginPath(); ctx.lineWidth = lineWidth; ctx.strokeStyle = color;
    for (let i=0;i<=SAMPLES;i++) { const x = i/SAMPLES*w, y = h/2 - data[i%SAMPLES]/peak*(h*.34); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }
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
      $('learning-state').textContent = 'Ready to play';
      updatePlaybackUI();
      if (recorded) captureStatus(`Captured ${noteName(pitch)} · ${Math.round(pitch)} Hz. Voice and learned synth are ready to compare below.`);
      status(locks.size && currentLoss/baseline > .0001 ? 'Fit complete with your locked harmonics. Unlock them for a closer match.' : 'The learned synth is ready. Compare it with Voice mode on the piano.');
    }
  }
  requestAnimationFrame(frame);
}
function startLearning(mode = 'synth') {
  if (locks.size === HARMONICS) { status('All harmonics are locked. Unlock at least one to teach the synth.'); return; }
  setPlaybackMode(mode); model.steps = 0; setTraining(true); updatePlaybackUI();
  listen(mode, { toggle:false, durationMs:mode === 'voice' ? 2500 : 8000 });
  status(mode === 'voice' ? 'You’re hearing your recorded Voice instrument. Handwired is learning a separate synth approximation.' : 'Listen as Handwired learns the harmonic target. The piano plays the learned synth.');
}
$('train').addEventListener('click', () => {
  if (training) { setTraining(false); stopAudition(); status('Learning paused. Play the current sound, or keep teaching.'); }
  else startLearning();
});
$('reset').addEventListener('click', () => { setTraining(false); setPlaybackMode('synth'); model.reset(); $('play-hint').textContent = 'The piano is back to a simple tone. Press Train this sound to learn your target again.'; sync(); status('Back to a simple tone. Your target and locks are kept.'); });
document.querySelectorAll('[data-vowel]').forEach(button => button.addEventListener('click', () => {
  if (busy) return; recorded = null; audio.clearVoiceRecording(); setPlaybackMode('synth'); $('listen-original').hidden = true; $('listen-voice').hidden = true;
  captureStatus('Record a steady vowel. Learning and playback start automatically.');
  document.querySelectorAll('[data-vowel]').forEach(other => { other.classList.toggle('selected', other===button); other.setAttribute('aria-pressed', String(other===button)); });
  setTarget(vowel(button.dataset.vowel), 196, `TARGET: SAMPLE ${button.dataset.vowel.toUpperCase()}${button.dataset.vowel[0].toUpperCase()}`);
  listen('target', { toggle:false });
  status(`Previewing “${button.dataset.vowel}${button.dataset.vowel[0]}”. Next, press Train this sound. Then play your instrument in step 3.`);
}));
$('record').addEventListener('click', async () => {
  if (busy) return;
  busy = true; silence(); setTraining(false);
  const controls = document.querySelectorAll('#record, #train, #reset, [data-vowel], .listen-row button, .playback-modes button, #save');
  let captured = false;
  controls.forEach(button => button.disabled = true);
  $('record-text').textContent = 'Waiting for microphone…'; status('Allow microphone access, then hold one comfortable note.');
  captureStatus('Allow microphone access, then hold a steady “ooo” for 2 seconds.');
  $('capture-meter').hidden = true;
  try {
    const recording = await audio.record(() => {
      $('record').classList.add('recording'); $('record-text').textContent = 'Listening… hold your note';
      $('capture-meter').hidden = false; $('capture-meter').value = 0;
      captureStatus('Listening… hold your vowel.'); status('Listening for 2 seconds. Hold a steady vowel.');
    }, ({ elapsed, level }) => {
      $('capture-meter').value = Math.min(1, level * 8);
      $('record-text').textContent = `Recording · ${Math.max(0, 2 - elapsed).toFixed(1)}s left`;
      captureStatus(level < .008 ? 'Very quiet — move closer and hold your note.' : 'Hearing you — keep holding that vowel.');
    });
    $('record-text').textContent = 'Finding your sound…';
    captureStatus('Recording captured. Finding your pitch and harmonics…');
    // Let the browser paint the analysis state before synchronous WASM work.
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = analyze(recording.samples, recording.sampleRate);
    audio.setVoiceRecording(recording, result.pitch);
    recorded = recording; playbackMode = 'voice';
    setTarget(result.amplitudes, result.pitch, 'TARGET: YOUR VOICE');
    document.querySelectorAll('[data-vowel]').forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed','false'); });
    $('listen-original').hidden = false; $('listen-voice').hidden = false;
    captured = true;
    captureStatus(`Captured your voice. Tuned to ${pianoNoteName(audio.voiceSample.rootMidi)}—play it on the piano below.`);
  } catch (error) {
    const message = error.name === 'NotAllowedError' ? 'Microphone access wasn’t granted. Allow access in your browser and record again, or try a sample.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect one, or try a sample sound.' : error.name === 'NotReadableError' ? 'The microphone could not start. Check your microphone input or close other apps using it, then try again.' : error.message;
    captureStatus(message, true); status(message);
  } finally { busy = false; controls.forEach(button => button.disabled = false); $('record-text').textContent = captured ? 'Record again' : 'Record my voice'; $('record').classList.remove('recording'); $('capture-meter').hidden = true; updatePlaybackUI(); }
  if (captured) { if (locks.size < HARMONICS) startLearning('voice'); else listen('voice', {toggle:false}); }
});
async function listen(kind, { toggle = true, durationMs = 3000 } = {}) {
  if (busy) return;
  const was = audition; silence(); if (toggle && was === kind) return;
  const ticket = epoch;
  try {
    await audio.ready(); if (epoch !== ticket) return;
    audition = kind; $(`listen-${kind}`).classList.add('active');
    $(`listen-${kind}`).textContent = `■ Playing ${kind === 'original' ? 'recording' : kind === 'synth' ? 'learned synth' : kind === 'voice' ? 'voice instrument' : 'target tone'} · stop`;
    if (kind === 'original' && recorded) await audio.playRecording(recorded.samples, recorded.sampleRate);
    else audio.note('audition', kind === 'voice' ? audio.voiceSample.rootFrequency : pitch, kind === 'target' ? target : model.weights, kind === 'voice' ? 'voice' : 'synth');
    auditionTimer = setTimeout(stopAudition, kind === 'original' ? 2100 : durationMs);
  } catch (error) { status(`Audio couldn’t start: ${error.message}`); stopAudition(); }
}
for (const kind of ['target','synth','original','voice']) $(`listen-${kind}`).addEventListener('click', () => listen(kind));
const frequencyFor = midi => 440 * 2 ** ((midi - 69) / 12);
let keyboardMode = 'wide', layout = keyboardLayout();
function refreshKey(midi) {
  keyElements.get(midi).classList.toggle('active', Array.from(held.values()).some(note => note.midi === midi));
  const guide = guideElements.get(midi);
  if (guide) guide.cell.classList.toggle('active', Array.from(held.values()).some(note => note.midi === guide.binding.midi || note.midi === guide.binding.sharp));
}
async function startNote(midi, id) {
  if (busy || held.has(id)) return;
  const note = { midi }, ticket = epoch;
  held.set(id, note);
  try {
    await audio.ready(); if (held.get(id) !== note || ticket !== epoch) return;
    stopAudition(); audio.note(id, frequencyFor(midi), model.weights, playbackMode); refreshKey(midi);
  } catch (error) { if (held.get(id) === note) held.delete(id); refreshKey(midi); status(`Audio couldn’t start: ${error.message}`); }
}
function stopNote(id) {
  const note = held.get(id); if (!note) return;
  held.delete(id); audio.stop(id); refreshKey(note.midi);
}
let whiteCount = 0;
for (let midi = 21; midi <= 108; midi++) {
  const black = [1,3,6,8,10].includes(midi % 12);
  const button = document.createElement('button'); button.className = `key ${black ? 'black':'white'}`;
  // Black keys sit on the boundary between their two white neighbours.
  button.style.left = `calc(var(--piano-key-width) * ${black ? whiteCount - .31 : whiteCount})`;
  if (!black) whiteCount++;
  const name = pianoNoteName(midi);
  button.dataset.note = name;
  button.innerHTML = `<span class="note-name">${name}</span><span class="typing-key"></span>`;
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); startNote(midi, `pointer-${event.pointerId}`); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type, event => stopNote(`pointer-${event.pointerId}`));
  button.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) startNote(midi, `accessible-${midi}`); } });
  button.addEventListener('keyup', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); stopNote(`accessible-${midi}`); } });
  button.addEventListener('blur', () => stopNote(`accessible-${midi}`));
  keyElements.set(midi,button); $('keyboard').append(button);
}
function setKeyboardOctave(octave) {
  layout = keyboardLayout(keyboardMode, octave);
  const shortcuts = new Map();
  for (const binding of layout.bindings) {
    shortcuts.set(binding.midi, binding.key.toUpperCase());
    if (binding.sharp !== null) shortcuts.set(binding.sharp, `⇧${binding.key.toUpperCase()}`);
  }
  for (const [midi, button] of keyElements) {
    const shortcut = shortcuts.get(midi);
    button.querySelector('.typing-key').textContent = shortcut || '';
    button.classList.toggle('mapped', Boolean(shortcut));
    button.setAttribute('aria-label', `Play ${button.dataset.note}${shortcut ? `, keyboard ${shortcut.replace('⇧','Shift+')}` : ''}`);
  }
  $('keyboard-range').textContent = `${pianoNoteName(layout.base)} – ${pianoNoteName(layout.end)}`;
  $('octave-down').disabled = layout.octave === 1;
  $('octave-up').disabled = layout.octave === layout.maxOctave;
  $('typing-help').textContent = keyboardMode === 'wide'
    ? 'Numbers → top letters → middle letters → bottom letters, from low to high. Hold Shift (⇧) for the black note above a white key. Mapped notes play even when they’re offscreen.'
    : 'A S D F G H J K play the white notes; W E T Y U play the black notes. Use [ / ] to change octave.';
  $('typing-guide').replaceChildren(); guideElements.clear();
  for (const binding of layout.bindings) {
    const cell = document.createElement('div'); cell.className = 'typing-guide-key';
    cell.innerHTML = `<kbd>${binding.key.toUpperCase()}</kbd><span>${pianoNoteName(binding.midi)}</span>${binding.sharp !== null ? `<small>⇧ ${pianoNoteName(binding.sharp)}</small>` : '<small>—</small>'}`;
    $('typing-guide').append(cell);
    guideElements.set(binding.midi, { cell, binding });
    if (binding.sharp !== null) guideElements.set(binding.sharp, { cell, binding });
    refreshKey(binding.midi);
  }
  $('chopin-guide').hidden = keyboardMode !== 'wide' || layout.octave !== 3;
  $('twinkle-guide').hidden = keyboardMode !== 'classic';
  const viewport = $('keyboard-scroll');
  // Start near the melody register; every mapped note remains reachable by typing.
  const center = keyElements.get(keyboardMode === 'wide' ? layout.base + 24 : layout.base + 7);
  viewport.scrollLeft = center.offsetLeft - viewport.clientWidth / 2 + center.offsetWidth / 2;
}
$('keyboard-layout').addEventListener('change', event => {
  keyboardMode = event.target.value;
  setKeyboardOctave(keyboardMode === 'wide' ? 3 : 4);
  $('keyboard-scroll').focus({ preventScroll:true });
});
$('octave-down').addEventListener('click', () => setKeyboardOctave(layout.octave - 1));
$('octave-up').addEventListener('click', () => setKeyboardOctave(layout.octave + 1));
setKeyboardOctave(layout.octave);
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return;
  if (event.code === 'BracketLeft' || event.code === 'BracketRight') { event.preventDefault(); setKeyboardOctave(layout.octave + (event.code === 'BracketLeft' ? -1 : 1)); return; }
  const midi = typedNote(layout, event.code, event.shiftKey);
  if (midi !== null) { event.preventDefault(); startNote(midi, `keyboard-${event.code}`); }
});
// Physical key identity keeps releases correct after Shift or octave changes.
window.addEventListener('keyup', event => stopNote(`keyboard-${event.code}`));
window.addEventListener('blur', silence);
document.addEventListener('visibilitychange', () => { if (document.hidden) { silence(); setTraining(false); } });
$('volume').addEventListener('input', event => audio.volume(Number(event.target.value)));
$('save').addEventListener('click', () => {
  const voice = playbackMode === 'voice' && audio.voiceSample;
  const data = { format:'meloform/v2', harmonicCount:HARMONICS, harmonics:Array.from(model.weights), sourcePitchHz:pitch, source:$('source-name').textContent, lockedHarmonics:Array.from(locks, h => h+1) };
  const blob = voice ? new Blob([encodeWav(voice.samples,voice.sampleRate)],{type:'audio/wav'}) : new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;
  a.download=voice ? `meloform-voice-${voice.sourcePitch.toFixed(1)}hz.wav` : 'my-meloform-synth.json';
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  status(voice ? `Saved your recorded voice loop as WAV at its original ${voice.sourcePitch.toFixed(1)} Hz pitch.` : 'Saved the learned synth recipe as JSON, without your recording.');
});
new ResizeObserver(() => { draw(model.evaluate().waveform); drawVoice(); }).observe($('scope'));
setTarget(target,pitch,'TARGET: SAMPLE OOO');
updatePlaybackUI();
requestAnimationFrame(frame);
