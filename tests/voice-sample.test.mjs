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
test('learned piano and preview use the same learned textures, separate from recorded reference',()=>{
  const engine=new AudioEngine(),sources=[];
  const source=()=>{const s={frequency:{value:0},connect(destination){return destination;},start(){},stop(){this.stopped=true;},disconnect(){},setPeriodicWave(){this.waveUpdates=(this.waveUpdates||0)+1;}};sources.push(s);return s;};
  engine.context={sampleRate:rate,currentTime:0,
    createBuffer:(_,length,sampleRate)=>({sampleRate,copyToChannel(samples){this.data=samples.slice();}}),
    createOscillator:source,createPeriodicWave:()=>({}),
    createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}},connect(){},disconnect(){}})};
  engine.createSustainVoice=(_context,grains,frequency)=>Object.assign(source(),{grains,frequency});
  engine.master={};
  const voice=engine.setVoiceRecording({samples:recording(),sampleRate:rate},pitch);
  assert.throws(()=>engine.note('not-ready',220,[],'synth'),/not ready/);
  const learned=engine.voiceGrains.map(grain=>grain.map(x=>-x));
  engine.setLearnedGrains(learned);
  engine.note('preview',voice.rootFrequency,[],'synth');
  engine.note('key',voice.rootFrequency,[],'synth');
  engine.note('reference',voice.rootFrequency,[],'voice');
  assert.deepEqual(sources[0].grains,sources[1].grains);
  assert.notDeepEqual(sources[0].grains,sources[2].grains);
  assert.equal(sources[0].frequency,voice.rootFrequency);
  engine.update(new Float32Array(64));
  assert.equal(sources[0].waveUpdates,undefined);
  engine.stop('preview');assert.equal(sources[0].stopped,true);
  engine.stopAll();assert.equal(engine.voices.size,0);
  const plain=engine.grainsFor(voice.rootFrequency,'voice');
  const corrected=voice.samples.map(x=>-x);
  engine.setVoiceCorrections(new Map([[voice.rootMidi,{accepted:true,samples:corrected}],[voice.rootMidi+1,{accepted:false}]]));
  assert.notDeepEqual(engine.grainsFor(voice.rootFrequency,'voice'),plain);
  engine.voiceCorrectionEnabled=false;
  assert.deepEqual(engine.grainsFor(voice.rootFrequency,'voice'),plain);
  engine.setVoiceRecording({samples:recording(),sampleRate:rate},pitch);
  assert.equal(engine.voiceCorrections.size,0);assert.equal(engine.learnedGrains,null);assert.equal(engine.sustainCache.size,0);
  engine.clearVoiceRecording();engine.note('sample',220,[1,0,0],'synth');engine.update([.5,.5,0]);
  assert.equal(sources.at(-1).waveUpdates,2);
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
