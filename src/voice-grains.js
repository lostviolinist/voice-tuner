import { fft } from './fft.js';
export const GRAIN_SIZE = 1024, GRAIN_CYCLES = 4, GRAIN_COUNT = 16;
const interpolate = (samples, at) => {
  const i = Math.floor(at), mix = at - i;
  return samples[i] * (1 - mix) + samples[i + 1] * mix;
};

// Track the local period and align each segment to its fundamental phase.
// Each segment spans four cycles; no segment contains the whole sung phrase.
export function grainPlan(samples, sampleRate, pitch) {
  const nominal = sampleRate / pitch, margin = Math.ceil(nominal * 12);
  if (samples.length < margin * 2 + 2) throw new Error('Hold the note a little longer for a smooth sustain.');
  return Array.from({length:GRAIN_COUNT}, (_, g) => {
    const center = Math.round(margin + (samples.length - 2 * margin - 2) * g / (GRAIN_COUNT - 1));
    const start = center - Math.round(3 * nominal), length = Math.round(6 * nominal);
    const correlations = [], low = Math.floor(nominal * .92), high = Math.ceil(nominal * 1.08);
    let best = -Infinity, lag = Math.round(nominal);
    for (let k = low; k <= high; k++) {
      let xy = 0, xx = 0, yy = 0;
      for (let i = start; i < start + length; i++) { const a = samples[i], b = samples[i + k]; xy += a*b; xx += a*a; yy += b*b; }
      const score = xy / Math.sqrt(Math.max(xx * yy, 1e-20));
      correlations[k] = score;
      if (score > best) { best = score; lag = k; }
    }
    let period = lag;
    if (lag > low && lag < high) {
      const a = correlations[lag - 1], b = correlations[lag], c = correlations[lag + 1];
      period += Math.max(-.5, Math.min(.5, .5 * (a - c) / (a - 2*b + c || 1)));
    }
    let sine = 0, cosine = 0;
    for (let i = 0; i < Math.round(period * 8); i++) {
      const w = .5 - .5 * Math.cos(2 * Math.PI * i / (period * 8));
      const x = samples[center + i] * w, phase = 2 * Math.PI * i / period;
      sine += x * Math.sin(phase); cosine += x * Math.cos(phase);
    }
    const phase = Math.atan2(cosine, sine);
    return {start:center + ((-phase / (2*Math.PI) + 1) % 1) * period, period};
  });
}

export function extractGrains(samples, plan) {
  const grains = plan.map(({start, period}) => {
    const grain = Float32Array.from({length:GRAIN_SIZE}, (_, i) => interpolate(samples, start + i / GRAIN_SIZE * GRAIN_CYCLES * period));
    const mean = grain.reduce((sum, x) => sum + x, 0) / grain.length;
    return grain.map(x => x - mean);
  });
  // Remove the recorded phrase's loud/quiet contour from the sustain. Retain
  // the within-segment waveform and breath texture, with bounded level changes.
  const levels = grains.map(g => Math.sqrt(g.reduce((s,x) => s+x*x,0) / g.length));
  const level = [...levels].sort((a,b) => a-b)[Math.floor(levels.length / 2)];
  return grains.map((g,i) => g.map(x => x * Math.max(.5, Math.min(2, level / Math.max(levels[i],1e-8)))));
}

export function filterGrains(grains, frequency, sampleRate, correction = null) {
  return grains.map(grain => {
    const real = Float64Array.from(grain), imag = new Float64Array(grain.length);
    fft(real, imag);
    for (let i = 0; i < real.length; i++) {
      const bin = Math.min(i, real.length-i), hz = bin * frequency / GRAIN_CYCLES;
      let gain = hz < sampleRate * .45 ? 1 : 0;
      if (gain && correction) {
        const {weights, centers} = correction, lo = centers[0], hi = centers.at(-1);
        if (hz > lo/2 && hz < hi*1.5) {
          const at = Math.max(0,Math.min(1,Math.log(hz/lo)/Math.log(hi/lo))) * (weights.length-1);
          const left = Math.min(weights.length-2,Math.floor(at)), mix = at-left;
          const taper = Math.min(1,(hz-lo/2)/(lo/2),(hi*1.5-hz)/(hi*.5));
          gain *= 10 ** ((weights[left]*(1-mix)+weights[left+1]*mix)*taper/20);
        }
      }
      real[i] *= gain; imag[i] *= gain;
    }
    fft(real, imag, true);
    const before = grain.reduce((s,x)=>s+x*x,0), after = real.reduce((s,x)=>s+x*x,0);
    const gain = Math.min(2,Math.sqrt(before/Math.max(after,1e-20)));
    return Float32Array.from(real,x=>x*gain);
  });
}

// Shared by the real AudioWorklet and offline regression tests. Two Hann-
// windowed, phase-aligned grains overlap. Each replacement selects another
// segment; the recording never seeks back to the beginning of a phrase.
export class SustainRenderer {
  constructor(grains, frequency, sampleRate, seed = 1) {
    this.grains = grains; this.seed = seed >>> 0 || 1;
    this.step = frequency * GRAIN_SIZE / (GRAIN_CYCLES * sampleRate);
    this.active = [{at:0, index:0}, {at:GRAIN_SIZE/2, index:Math.min(1,grains.length-1)}];
  }
  nextIndex(previous) {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    if (this.grains.length < 2) return 0;
    return (previous + 1 + (this.seed >>> 0) % (this.grains.length-1)) % this.grains.length;
  }
  process(output) {
    for (let i=0;i<output.length;i++) {
      let sum=0, weight=0;
      for (const active of this.active) {
        const grain=this.grains[active.index], at=active.at, index=Math.floor(at), mix=at-index;
        const w=.5-.5*Math.cos(2*Math.PI*at/GRAIN_SIZE);
        sum+=(grain[index]*(1-mix)+grain[(index+1)%GRAIN_SIZE]*mix)*w; weight+=w;
        active.at+=this.step;
        if (active.at>=GRAIN_SIZE) { active.at-=GRAIN_SIZE; active.index=this.nextIndex(active.index); }
      }
      output[i]=sum/Math.max(weight,1e-8);
    }
  }
}

export function createSustainVoice(context, grains, frequency) {
  const node = new AudioWorkletNode(context,'voice-sustain',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{grains,frequency,seed:Math.floor(Math.random()*0xffffffff)}});
  node.start = () => {};
  node.stop = time => node.port.postMessage({stopFrame:Math.round(time*context.sampleRate)});
  node.port.onmessage = ({data}) => { if(data==='ended'){node.onended?.();node.port.close();} };
  return node;
}
