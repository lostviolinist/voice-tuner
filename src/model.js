import { Circuit } from './vendor/numeric-ui-core.js';
import { cycle } from './dsp.js';
export { cycle } from './dsp.js';
export const HARMONICS = 64;
export const SAMPLES = 256;
export const initialWeights = () => Float32Array.from({ length: HARMONICS }, (_, i) => i === 0 ? .65 : .018);
export class Instrument {
  constructor() {
    this.circuit = new Circuit(HARMONICS + SAMPLES);
    this.source = new Float32Array(HARMONICS + SAMPLES);
    this.outputs = [];
    const errors = [];
    for (let s = 0; s < SAMPLES; s++) {
      const output = this.circuit.affine(Array.from({ length: HARMONICS }, (_, h) => [this.circuit.source(h), Math.sin(2 * Math.PI * (h + 1) * s / SAMPLES)]));
      this.outputs.push(output);
      const error = this.circuit.affine([[output, 1], [this.circuit.source(HARMONICS + s), -1]]);
      errors.push([this.circuit.multiply(error, error), 1 / SAMPLES]);
    }
    this.lossWire = this.circuit.affine(errors);
    this.reset();
  }
  get weights() { return this.source.subarray(0, HARMONICS); }
  reset() { this.source.set(initialWeights()); this.steps = 0; }
  setTarget(amplitudes) { this.source.set(cycle(amplitudes), HARMONICS); this.steps = 0; }
  evaluate() {
    const values = this.circuit.evaluateReference(this.source);
    return { loss: values[this.lossWire], waveform: Float32Array.from(this.outputs, wire => values[wire]) };
  }
  train(locked = new Set()) {
    const values = this.circuit.evaluateReference(this.source);
    const seed = new Float32Array(values.length);
    seed[this.lossWire] = 1;
    const gradients = this.circuit.backpropagateReference(values, seed);
    for (let h = 0; h < HARMONICS; h++) if (!locked.has(h)) this.source[h] = Math.min(1, Math.max(0, this.source[h] - .045 * gradients[h]));
    this.steps++;
    return values[this.lossWire];
  }
}
