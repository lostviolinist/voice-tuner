import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../scripts/build.mjs';
import { readFile } from 'node:fs/promises';
import { AudioEngine } from '../src/audio.js';
await build();
// Register voice-correction cases after the single shared build.
await import('./voice-tone-cases.mjs');
const { initDSP } = await import('../dist/dsp.js');
await initDSP(await readFile(new URL('../dist/voice_dsp.wasm',import.meta.url)));
const { Instrument, cycle } = await import('../dist/model.js');
const { vowel, analyze } = await import('../dist/analysis.js');
test('each vowel reaches playback with a distinct harmonic shape at the same pitch', () => {
  const engine = new AudioEngine();
  engine.context = { sampleRate:48000, createPeriodicWave:(_real,imaginary) => imaginary.slice() };
  const waves = ['oo','aa','ee'].map(kind => engine.wave(vowel(kind),196));
  for (let a=0;a<waves.length;a++) for (let b=a+1;b<waves.length;b++) {
    const norm = wave => Math.sqrt(wave.reduce((sum,value)=>sum+value*value,0));
    const na=norm(waves[a]), nb=norm(waves[b]);
    const distance=Math.sqrt(waves[a].reduce((sum,value,i)=>sum+(value/na-waves[b][i]/nb)**2,0));
    assert.ok(distance>.4, 'vowels must differ in spectrum, not merely volume');
  }
});
test('changing a target retains the current instrument until it is taught or reset', () => {
  const instrument=new Instrument(); instrument.setTarget(vowel('aa'));
  for(let i=0;i<180;i++) instrument.train();
  const before=instrument.weights.slice(); instrument.setTarget(vowel('ee'));
  assert.deepEqual(instrument.weights,before);
  for(let i=0;i<180;i++) instrument.train();
  assert.ok(instrument.weights.every((value,i)=>Math.abs(value-vowel('ee')[i])<.001));
});
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

test('recorded vowels retain their harmonics with vibrato, drift, and an uneven onset', () => {
  for (const kind of ['oo','aa','ee']) {
    const sampleRate=48000, pitch=196, target=vowel(kind,pitch); let phase=0;
    const samples=Float32Array.from({length:sampleRate*2},(_,i)=>{
      const t=i/sampleRate;
      phase+=2*Math.PI*pitch*(1+.02*Math.sin(2*Math.PI*5*t)+.006*(t-1))/sampleRate;
      const envelope=Math.min(1,t/.3) * (.8+.2*Math.sin(2*Math.PI*1.7*t));
      return envelope*target.reduce((sum,a,h)=>sum+.1*a*Math.sin((h+1)*phase+h*.23),0);
    });
    const result=analyze(samples,sampleRate);
    assert.ok(Math.abs(result.pitch-pitch)<6);
    assert.ok(result.amplitudes.every((a,h)=>Math.abs(a-target[h])<.08),`${kind}: vibrato must not erase upper harmonics`);
    const instrument=new Instrument(); instrument.setTarget(result.amplitudes);
    for(let i=0;i<200;i++) instrument.train();
    assert.ok(instrument.weights.every((a,h)=>Math.abs(a-target[h])<.08));
  }
});

test('a custom low-pitched timbre retains strong overtones beyond the old 16-harmonic limit', () => {
  const sampleRate=44100,pitch=110,target=new Float32Array(64);
  target[0]=.7; target[1]=.25; target[5]=.4; target[23]=.65; target[31]=.85; target[42]=.5;
  let phase=0,seed=17;
  const samples=Float32Array.from({length:sampleRate*2},(_,i)=>{
    phase+=2*Math.PI*pitch*(1+.01*Math.sin(2*Math.PI*4*i/sampleRate))/sampleRate;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return target.reduce((sum,a,h)=>sum+.12*a*Math.sin((h+1)*phase+.37*h),0)+(seed/4294967296-.5)*.002;
  });
  const result=analyze(samples,sampleRate);
  assert.ok(Math.abs(result.pitch-pitch)<3);
  for(const h of [0,1,5,23,31,42]) assert.ok(Math.abs(result.amplitudes[h]-target[h])<.09,`harmonic ${h+1}: ${result.amplitudes[h]}`);
});
