import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceSample } from '../src/voice-sample.js';
import { VoiceToneTrainer } from '../src/voice-tone-trainer.js';
import { voiceFixture } from './helpers/voice-fixtures.mjs';
const { fft, VoiceToneModel, prepareToneTraining, trainVoiceNote, renderCorrection, MAX_TONE_GAIN_DB } = await import('../dist/voice-tone.js');

test('FFT retains complex phase and round-trips an independent multi-tone signal', () => {
  const real = Float64Array.from({length:4096}, (_, i) => .3 * Math.cos(2 * Math.PI * 19 * i / 4096 + .7) + .1 * Math.sin(2 * Math.PI * 53 * i / 4096));
  const original = real.slice(), imaginary = new Float64Array(real.length);
  fft(real, imaginary);
  assert.ok(Math.abs(Math.hypot(real[19], imaginary[19]) / 2048 - .3) < 1e-10);
  assert.ok(Math.abs(Math.atan2(imaginary[19], real[19]) - .7) < 1e-10);
  fft(real, imaginary, true);
  assert.ok(real.every((value, i) => Math.abs(value - original[i]) < 1e-10));
});

test('Handwired actually learns bounded correction weights and reduces its loss', () => {
  const target = Float64Array.from({length:48}, (_, i) => 5 * Math.sin(i / 9));
  const model = new VoiceToneModel(target, new Float64Array(48));
  const before = model.loss();
  assert.ok(model.weights.every(value => value === 0));
  for (let i = 0; i < 140; i++) model.train();
  assert.ok(model.loss() < before * .05);
  assert.ok(model.weights.some(value => Math.abs(value) > 1));
  assert.ok(model.weights.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_TONE_GAIN_DB));
});

test('learned filters improve held-out rendered spectral shape across pitches, voices, and sample rates', () => {
  for (const sr of [44100, 48000]) for (const formants of [[700,1200], [300,2400], [400,800]]) {
    const voice = prepareVoiceSample(voiceFixture(sr, 196, formants), sr, 196), original = voice.samples.slice();
    const prepared = prepareToneTraining(voice);
    for (const shift of [-12, -7, 7, 12]) {
      const result = trainVoiceNote(prepared, voice.rootMidi + shift);
      assert.equal(result.accepted, true, `${sr}, ${formants}, ${shift}`);
      assert.ok(result.after < result.before * .9, `held-out improvement: ${result.before} -> ${result.after}`);
      assert.ok(result.samples.every(value => Number.isFinite(value) && Math.abs(value) <= .95001));
      assert.equal(result.samples.length, voice.samples.length);
      const rms = data => Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
      assert.ok(Math.abs(rms(result.samples) / rms(voice.samples) - 1) < .01, 'on/off comparison must not just be louder');
    }
    assert.deepEqual(voice.samples, original, 'original recording must remain intact');
  }
});

test('neutral correction preserves PCM and already-matching root keeps the original sample', () => {
  const voice = prepareVoiceSample(voiceFixture(), 48000, 196), prepared = prepareToneTraining(voice);
  const rendered = renderCorrection(voice.samples, 48000, 1, new Float32Array(20), prepared.centers);
  assert.ok(rendered.every((value, i) => Math.abs(value - voice.samples[i]) < 1e-7));
  const root = trainVoiceNote(prepared, voice.rootMidi);
  assert.equal(root.accepted, false);
  assert.equal(root.samples, null);
  assert.equal(root.after, root.before);
});

test('a filter that fits one vowel but worsens a different held-out vowel is rejected', () => {
  const sr = 48000, samples = new Float32Array(38400);
  samples.set(voiceFixture(sr, 196, [700,1200], false).subarray(0,19200));
  samples.set(voiceFixture(sr, 196, [300,2400], false).subarray(0,19200),19200);
  const prepared = prepareToneTraining({samples, sampleRate:sr, sourcePitch:196, rootMidi:55});
  for (const shift of [-12, -7, 7, 12]) {
    const result = trainVoiceNote(prepared, 55 + shift);
    assert.ok(result.loss < result.initialLoss, 'training fit alone looks successful');
    assert.ok(result.candidateError > result.before, 'held-out audio exposes a worse filter');
    assert.equal(result.accepted, false);
    assert.equal(result.samples, null);
    assert.equal(result.after, result.before);
  }
});

test('trainer cancels old recordings, ignores stale results, and reports worker failure without hanging', () => {
  const updates = [], workers = [];
  const trainer = new VoiceToneTrainer(value => updates.push(value), () => {
    const worker = {postMessage(){}, terminate(){this.terminated = true;}};
    workers.push(worker); return worker;
  });
  trainer.start({rootMidi:55}); const old = workers[0];
  trainer.start({rootMidi:60}); assert.equal(old.terminated, true);
  old.onmessage({data:{type:'complete'}});
  assert.equal(updates.length, 2);
  workers[1].onmessage({data:{type:'note', midi:60, done:1, total:25}});
  workers[1].onmessage({data:{type:'complete', low:48, high:72, accepted:1, before:3, after:2}});
  assert.equal(updates.at(-1).state, 'ready');
  assert.equal(updates.at(-1).notes.size, 1);
  assert.equal(workers[1].terminated, true);
  trainer.start({rootMidi:55}); workers[2].onerror(new Error('test failure'));
  assert.equal(updates.at(-1).state, 'error');
  assert.equal(trainer.worker, null);
});
