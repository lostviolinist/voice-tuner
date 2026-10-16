import { Circuit } from './vendor/numeric-ui-core.js';

const FFT_SIZE = 4096, HOP = FFT_SIZE / 4, BANDS = 48, CONTROLS = 20;
export const MAX_TONE_GAIN_DB = 9;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const frequencyFor = midi => 440 * 2 ** ((midi - 69) / 12);
const window = Float64Array.from({length:FFT_SIZE}, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / FFT_SIZE));

// Radix-2 FFT. Analysis and rendering use the same frequency grid, but fit
// acceptance is measured from rendered audio held out of the training data.
export function fft(real, imaginary, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let ur = 1, ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const tr = real[b] * ur - imaginary[b] * ui, ti = real[b] * ui + imaginary[b] * ur;
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
        real[a] += tr; imaginary[a] += ti;
        const next = ur * wr - ui * wi; ui = ur * wi + ui * wr; ur = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imaginary[i] /= n; }
}

export function spectrum(samples, sampleRate) {
  const power = new Float64Array(FFT_SIZE / 2 + 1);
  let frames = 0;
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
    const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) real[i] = samples[start + i] * window[i];
    fft(real, imaginary);
    for (let i = 0; i < power.length; i++) power[i] += real[i] ** 2 + imaginary[i] ** 2;
    frames++;
  }
  if (!frames) throw new Error('Record a longer steady note to teach the voice correction.');
  for (let i = 0; i < power.length; i++) power[i] /= frames;
  return {power, sampleRate};
}

function frequencies(sampleRate, pitch) {
  const low = Math.max(180, pitch * 1.5), high = Math.min(7000, sampleRate / 5);
  return Float64Array.from({length:BANDS}, (_, i) => low * (high / low) ** (i / (BANDS - 1)));
}

// Smooth over harmonics rather than attempting to match individual harmonic
// frequencies, which necessarily move when playing a new note.
export function envelope(spec, centers, pitch, ratio = 1) {
  const {power, sampleRate} = spec, binHz = sampleRate / FFT_SIZE;
  const result = Float64Array.from(centers, center => {
    const width = Math.max(pitch * ratio * 1.5, center * .18);
    const lo = Math.max(1, Math.floor((center - width * 2) / (binHz * ratio)));
    const hi = Math.min(power.length - 1, Math.ceil((center + width * 2) / (binHz * ratio)));
    let sum = 0, weight = 0;
    for (let i = lo; i <= hi; i++) {
      const w = Math.exp(-.5 * ((i * binHz * ratio - center) / width) ** 2);
      sum += power[i] * w; weight += w;
    }
    return Math.max(1e-12, sum / Math.max(weight, 1e-12));
  });
  const peak = Math.max(...result);
  for (let i = 0; i < result.length; i++) result[i] = 10 * Math.log10(Math.max(result[i], peak * 1e-4));
  const mean = result.reduce((sum, n) => sum + n, 0) / result.length;
  return result.map(n => n - mean);
}

const error = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
function basis(position) {
  const p = clamp(position, 0, 1) * (CONTROLS - 1), left = Math.min(CONTROLS - 2, Math.floor(p));
  return [[left, 1 - (p - left)], [left + 1, p - left]];
}

export class VoiceToneModel {
  constructor(target, shifted) {
    this.circuit = new Circuit(CONTROLS + BANDS);
    this.source = new Float32Array(CONTROLS + BANDS);
    this.source.set(target.map((value, i) => value - shifted[i]), CONTROLS);
    const errors = [];
    for (let i = 0; i < BANDS; i++) {
      const terms = basis(i / (BANDS - 1)).map(([j, weight]) => [this.circuit.source(j), weight]);
      const difference = this.circuit.affine([...terms, [this.circuit.source(CONTROLS + i), -1]]);
      errors.push([this.circuit.multiply(difference, difference), 1 / BANDS]);
    }
    // Discourage large gains and abrupt curves, even where the recording has
    // little energy. Bounds are applied after each real backpropagation step.
    for (let i = 0; i < CONTROLS; i++) {
      const w = this.circuit.source(i);
      errors.push([this.circuit.multiply(w, w), .02 / CONTROLS]);
      if (i) {
        const d = this.circuit.affine([[w, 1], [this.circuit.source(i - 1), -1]]);
        errors.push([this.circuit.multiply(d, d), .08 / CONTROLS]);
      }
    }
    this.lossWire = this.circuit.affine(errors);
    this.steps = 0;
  }
  get weights() { return this.source.subarray(0, CONTROLS); }
  loss() { return this.circuit.evaluateReference(this.source)[this.lossWire]; }
  train() {
    const values = this.circuit.evaluateReference(this.source), seed = new Float32Array(values.length);
    seed[this.lossWire] = 1;
    const gradient = this.circuit.backpropagateReference(values, seed);
    for (let i = 0; i < CONTROLS; i++) this.source[i] = clamp(this.source[i] - 2 * gradient[i], -MAX_TONE_GAIN_DB, MAX_TONE_GAIN_DB);
    this.steps++;
  }
}

export function correctionDb(weights, frequency, centers) {
  const lo = centers[0], hi = centers.at(-1);
  if (frequency <= lo / 2 || frequency >= hi * 1.5) return 0;
  const position = Math.log(frequency / lo) / Math.log(hi / lo);
  const db = basis(position).reduce((sum, [i, w]) => sum + weights[i] * w, 0);
  const edge = Math.min(1, (frequency - lo / 2) / (lo / 2), (hi * 1.5 - frequency) / (hi * .5));
  return db * Math.max(0, edge);
}

// Circular overlap-add keeps the existing loop duration and phase. The filter
// is applied in source-frequency coordinates so playbackRate transposes the
// corrected recording to the intended piano note without changing its tuning.
export function renderCorrection(samples, sampleRate, ratio, weights, centers) {
  const output = new Float64Array(samples.length), normalization = new Float64Array(samples.length);
  const gains = Float64Array.from({length:FFT_SIZE / 2 + 1}, (_, i) => 10 ** (correctionDb(weights, i * sampleRate / FFT_SIZE * ratio, centers) / 20));
  for (let start = 0; start < samples.length; start += HOP) {
    const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) real[i] = samples[(start + i) % samples.length] * window[i];
    fft(real, imaginary);
    for (let i = 0; i < FFT_SIZE; i++) { const gain = gains[Math.min(i, FFT_SIZE - i)]; real[i] *= gain; imaginary[i] *= gain; }
    fft(real, imaginary, true);
    for (let i = 0; i < FFT_SIZE; i++) {
      const at = (start + i) % samples.length;
      output[at] += real[i] * window[i]; normalization[at] += window[i] ** 2;
    }
  }
  let inputEnergy = 0, outputEnergy = 0, peak = 0;
  for (let i = 0; i < output.length; i++) {
    output[i] /= normalization[i]; inputEnergy += samples[i] ** 2; outputEnergy += output[i] ** 2; peak = Math.max(peak, Math.abs(output[i]));
  }
  // Match RMS for a fair on/off comparison; leave headroom for the compressor.
  const gain = Math.min(Math.sqrt(inputEnergy / Math.max(outputEnergy, 1e-20)), .95 / Math.max(peak, 1e-20));
  return Float32Array.from(output, value => value * gain);
}

export function prepareToneTraining(voice) {
  // Separate halves avoid scoring the exact audio used to fit the curve.
  const half = Math.floor(voice.samples.length / 2), centers = frequencies(voice.sampleRate, voice.sourcePitch);
  const training = spectrum(voice.samples.subarray(0, half), voice.sampleRate);
  const validation = spectrum(voice.samples.subarray(half), voice.sampleRate);
  return {voice, half, centers, training, validation,
    target:envelope(training, centers, voice.sourcePitch), validationTarget:envelope(validation, centers, voice.sourcePitch)};
}

export function trainVoiceNote(prepared, midi) {
  const {voice, half, centers, training, validation, target, validationTarget} = prepared;
  const ratio = frequencyFor(midi) / voice.sourcePitch;
  const model = new VoiceToneModel(target, envelope(training, centers, voice.sourcePitch, ratio));
  const initialLoss = model.loss();
  for (let i = 0; i < 140; i++) model.train();
  const samples = renderCorrection(voice.samples, voice.sampleRate, ratio, model.weights, centers);
  const before = error(validationTarget, envelope(validation, centers, voice.sourcePitch, ratio));
  const after = error(validationTarget, envelope(spectrum(samples.subarray(half), voice.sampleRate), centers, voice.sourcePitch, ratio));
  // A numerical fit is not enough: keep only filters that improve the measured
  // spectral shape of held-out rendered audio. Never claim perceptual identity.
  const accepted = Number.isFinite(after) && after < before * .99 && before > .05;
  return {midi, samples:accepted ? samples : null, weights:Array.from(model.weights), before, after:accepted ? after : before,
    candidateError:after, accepted, initialLoss, loss:model.loss(), steps:model.steps};
}
