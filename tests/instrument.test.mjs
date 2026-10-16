import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../scripts/build.mjs';
import { readFile } from 'node:fs/promises';
await build();
const { initDSP } = await import('../dist/dsp.js');
await initDSP(await readFile(new URL('../dist/voice_dsp.wasm',import.meta.url)));
const { Instrument, cycle } = await import('../dist/model.js');
const { vowel, analyze } = await import('../dist/analysis.js');
test('Handwired synthesis agrees with an independent additive reference', () => {
  const instrument = new Instrument(); instrument.source.set(vowel('aa'));
  const expected = cycle(instrument.weights), actual = instrument.evaluate().waveform;
  assert.ok(actual.every((value,i) => Math.abs(value-expected[i]) < 2e-6));
});
test('actual backpropagation converges for all sample vowels', () => {
  for (const sound of ['oo','aa','ee']) {
    const instrument = new Instrument(); const target = vowel(sound); instrument.setTarget(target);
    const before = instrument.evaluate().loss;
    for (let i=0;i<200;i++) instrument.train();
    assert.ok(instrument.evaluate().loss < before * .000001);
    assert.ok(instrument.weights.every((value,i) => Math.abs(value-target[i]) < .0001));
  }
});
test('locked harmonics stay fixed while remaining parameters learn', () => {
  const instrument = new Instrument(); instrument.setTarget(vowel('ee')); const original = instrument.weights[0];
  for (let i=0;i<160;i++) instrument.train(new Set([0]));
  assert.equal(instrument.weights[0], original);
  assert.ok(Math.abs(instrument.weights[8]-vowel('ee')[8]) < .001);
});
test('microphone analysis recovers pitch and timbre across sample rates', () => {
  for (const sampleRate of [44100,48000]) for (const pitch of [110,196,330]) {
    const target = vowel('aa',pitch);
    const samples = Float32Array.from({ length:sampleRate*2 }, (_,i) => target.reduce((sum,a,h) => sum + .12*a*Math.sin(2*Math.PI*(h+1)*pitch*i/sampleRate + h*.23),0));
    const result = analyze(samples,sampleRate);
    assert.ok(Math.abs(result.pitch-pitch)<1, `${pitch}: ${result.pitch}`);
    assert.ok(result.amplitudes.every((a,i) => Math.abs(a-target[i])<.04));
  }
});
test('silence and nonperiodic noise are rejected', () => {
  assert.throws(() => analyze(new Float32Array(96000),48000), /quiet/);
  let seed=42;
  const noise=Float32Array.from({length:96000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return (seed/4294967296-.5)*.3;});
  assert.throws(() => analyze(noise,48000), /steady note/);
});
