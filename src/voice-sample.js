// Retain recorded PCM, including phase and noisy texture, instead of rebuilding
// it from harmonic magnitudes. Only the loop seam is crossfaded.
export function prepareVoiceSample(samples, sampleRate, sourcePitch) {
  if (!Number.isFinite(sourcePitch) || sourcePitch <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length < sampleRate * .15 || samples.some(value => !Number.isFinite(value))) {
    throw new Error('This recording cannot be made into a voice instrument. Record again.');
  }
  const fade = Math.max(2, Math.round(sampleRate * .025));
  const period = sampleRate / sourcePitch;
  const length = Math.min(Math.round(Math.round(sourcePitch * .8) * period), samples.length - fade);
  const span = length + fade;
  const prefix = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) prefix[i+1] = prefix[i] + samples[i] * samples[i];
  let start = 0, bestEnergy = -1;
  const margin = samples.length > span + sampleRate * .4 ? Math.round(sampleRate * .2) : 0;
  for (let i = margin; i <= samples.length - span - margin; i += Math.max(1, Math.round(sampleRate * .02))) {
    const energy = prefix[i + span] - prefix[i];
    if (energy > bestEnergy) { bestEnergy = energy; start = i; }
  }
  const loop = samples.slice(start + fade, start + span);
  for (let i = 0; i < fade; i++) {
    const mix = i / (fade - 1);
    loop[length - fade + i] = samples[start + length + i] * (1 - mix) + samples[start + i] * mix;
  }
  let peak = 0;
  for (const sample of loop) peak = Math.max(peak, Math.abs(sample));
  if (peak < .001) throw new Error('That recording is too quiet. Try again closer to the microphone.');
  const rootMidi = Math.round(69 + 12 * Math.log2(sourcePitch / 440));
  const rootFrequency = 440 * 2 ** ((rootMidi - 69) / 12);
  return { samples:loop, sampleRate, sourcePitch, rootMidi, rootFrequency,
    tuningCents:1200*Math.log2(rootFrequency/sourcePitch), gain:Math.min(8,.8/peak), start:start + fade, fade };
}
export function samplePlaybackRate(sample, frequency) {
  return frequency / sample.sourcePitch;
}
export function encodeWav(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (at, value) => { for(let i=0;i<value.length;i++) view.setUint8(at+i,value.charCodeAt(i)); };
  text(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); text(8,'WAVE'); text(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  text(36,'data'); view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true);}
  return bytes;
}
