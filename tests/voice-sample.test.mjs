import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVoiceSample, samplePlaybackRate, encodeWav } from '../src/voice-sample.js';
import { AudioEngine } from '../src/audio.js';
const rate=48000, pitch=205;
function recording() {
  let seed=32;
  return Float32Array.from({length:rate*2},(_,i)=>{
    const t=i/rate;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return .16*Math.sin(2*Math.PI*pitch*t+.4)+.07*Math.sin(2*Math.PI*pitch*3*t+1.8)+.035*(seed/4294967296-.5)*(1+Math.sin(12*t));
  });
}
test('voice loop retains the real waveform and noisy texture outside its crossfade',()=>{
  const input=recording(),before=input.slice(),voice=prepareVoiceSample(input,rate,pitch);
  assert.deepEqual(input,before);
  assert.deepEqual(voice.samples.slice(0,-voice.fade),input.slice(voice.start,voice.start+voice.samples.length-voice.fade));
  assert.ok(voice.samples.length/rate>.7);
  assert.equal(voice.samples.at(-1),input[voice.start-1]);
  assert.equal(voice.samples[0],input[voice.start]);
});
test('nearest-note tuning and every piano note use the measured pitch, without rounding away detuning',()=>{
  const voice=prepareVoiceSample(recording(),rate,pitch);
  assert.equal(voice.rootMidi,56); // G-sharp 3, slightly above the recorded pitch.
  assert.ok(Math.abs(voice.sourcePitch*samplePlaybackRate(voice,voice.rootFrequency)-207.6523488)<.0001);
  for(let midi=21;midi<=108;midi++){
    const target=440*2**((midi-69)/12);
    assert.ok(Math.abs(voice.sourcePitch*samplePlaybackRate(voice,target)-target)<1e-8);
  }
  assert.equal(samplePlaybackRate(voice,pitch),1);
});
test('voice mode uses a looping audio buffer; synth updates cannot replace it with a periodic wave',()=>{
  const engine=new AudioEngine(),sources=[];
  const source=()=>{const s={playbackRate:{value:0},frequency:{value:0},connect(destination){return destination;},start(){this.started=true;},stop(){this.stopped=true;},disconnect(){this.disconnected=true;},setPeriodicWave(){this.waveUpdates=(this.waveUpdates||0)+1;}};sources.push(s);return s;};
  engine.context={sampleRate:rate,currentTime:0,
    createBuffer:(_,length,sampleRate)=>({sampleRate,copyToChannel(samples){this.data=samples.slice();}}),
    createBufferSource:source,createOscillator:source,createPeriodicWave:()=>({}),
    createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}},connect(){},disconnect(){}})};
  engine.master={};
  const voice=engine.setVoiceRecording({samples:recording(),sampleRate:rate},pitch);
  engine.note('a',voice.rootFrequency,new Float32Array(64),'voice');
  engine.note('b',voice.rootFrequency*2,new Float32Array(64),'voice');
  engine.note('c',220,new Float32Array(64),'synth');
  assert.deepEqual(sources[0].buffer.data,voice.samples);
  assert.equal(sources[0].loop,true);
  assert.equal(sources[1].playbackRate.value,2*sources[0].playbackRate.value);
  engine.update(new Float32Array(64));
  assert.equal(sources[0].waveUpdates,undefined);
  assert.equal(sources[2].waveUpdates,2);
  engine.stop('a'); assert.equal(sources[0].stopped,true);assert.equal(engine.voices.has('b'),true);
  engine.stopAll();assert.equal(engine.voices.size,0);
  const corrected = voice.samples.map(value => -value);
  engine.setVoiceCorrections(new Map([[voice.rootMidi, {accepted:true, samples:corrected}], [voice.rootMidi + 1, {accepted:false}]]));
  engine.note('corrected', voice.rootFrequency, [], 'voice');
  assert.deepEqual(sources[3].buffer.data, corrected);
  assert.equal(sources[3].playbackRate.value, voice.rootFrequency / pitch);
  engine.note('outside', voice.rootFrequency * 4, [], 'voice');
  assert.deepEqual(sources[4].buffer.data, voice.samples);
  engine.note('rejected', voice.rootFrequency * 2 ** (1/12), [], 'voice');
  assert.deepEqual(sources[5].buffer.data, voice.samples);
  engine.voiceCorrectionEnabled = false;
  engine.note('bypass', voice.rootFrequency, [], 'voice');
  assert.deepEqual(sources[6].buffer.data, voice.samples);
  engine.stopAll(); engine.setVoiceRecording({samples:recording(),sampleRate:rate},pitch);
  assert.equal(engine.voiceCorrections.size, 0);
  assert.equal(engine.voiceCorrectionEnabled, false);
});
test('voice WAV export contains PCM samples rather than a harmonic recipe',()=>{
  const wav=encodeWav(new Float32Array([-1,0,1]),rate),view=new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0,4)),'RIFF');
  assert.equal(view.getUint32(24,true),rate);
  assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(48,true),32767);
});
test('invalid or silent recordings cannot produce a voice instrument',()=>{
  assert.throws(()=>prepareVoiceSample(new Float32Array(rate),rate,196),/quiet/);
  assert.throws(()=>prepareVoiceSample(recording(),rate,NaN),/cannot/);
});
