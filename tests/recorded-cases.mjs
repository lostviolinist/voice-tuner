import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { RecordedModel } from '../dist/recorded-model.js';
import { grainPlan, extractGrains, filterGrains, SustainRenderer } from '../src/voice-grains.js';
import { prepareVoiceSample } from '../src/voice-sample.js';
import { fft } from '../src/fft.js';
import { voiceFixture } from './helpers/voice-fixtures.mjs';
const energy=x=>x.reduce((sum,v)=>sum+v*v,0)/x.length;
const relativeError=(x,y)=>Math.sqrt(energy(x.map((v,i)=>v-y[i]))/energy(y));
function learn(grains){return grains.map(grain=>{const model=new RecordedModel(grain);for(let i=0;i<64;i++)model.train();return model.render();});}
function render(grains,hz,rate,seconds=1){const out=new Float32Array(Math.round(rate*seconds));new SustainRenderer(filterGrains(grains,hz,rate),hz,rate,123).process(out);return out;}
function bank(samples,rate,pitch){const voice=prepareVoiceSample(samples,rate,pitch);return extractGrains(voice.samples,grainPlan(voice.samples,rate,pitch));}
function spectrum(x){const n=8192,real=Float64Array.from(x.slice(0,n),(v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))),imag=new Float64Array(n);fft(real,imag);return Float64Array.from({length:n/2},(_,i)=>real[i]**2+imag[i]**2);}
function spectralDistance(x,y){const a=spectrum(x),b=spectrum(y),ea=a.reduce((s,x)=>s+x,0),eb=b.reduce((s,x)=>s+x,0);return a.reduce((s,x,i)=>s+Math.abs(x/ea-b[i]/eb),0);}

test('Handwired learns actual waveform phase and irregular texture, starting from silence',()=>{
  let seed=19;
  const grain=Float32Array.from({length:1024},(_,i)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return .3*Math.sin(2*Math.PI*4*i/1024+1.2)+.15*Math.sin(2*Math.PI*12*i/1024-.8)+.07*Math.sin(2*Math.PI*2*i/1024)+.08*(seed/4294967296-.5);
  });
  // DC and Nyquist are deliberately excluded from the model.
  const dc=grain.reduce((s,x)=>s+x,0)/1024,ny=grain.reduce((s,x,i)=>s+x*(i%2?-1:1),0)/1024;
  const reference=grain.map((x,i)=>x-dc-ny*(i%2?-1:1));
  const model=new RecordedModel(grain),before=model.loss();
  assert.equal(energy(model.render()),0);
  for(let i=0;i<64;i++)model.train();
  assert.ok(model.loss()<before*1e-10);
  assert.ok(relativeError(model.render(),reference)<1e-5);
});
test('recorded vowel differences survive actual Handwired learning and piano rendering at the same pitch',()=>{
  for(const rate of [44100,48000]){
    const outputs=[[350,800],[750,1200],[300,2400]].map(formants=>{
      const raw=bank(voiceFixture(rate,196,formants),rate,196),learned=learn(raw);
      const target=render(raw,196,rate),output=render(learned,196,rate);
      assert.ok(relativeError(output,target)<.005,'learned PCM should reconstruct captured texture');
      return output;
    });
    for(let a=0;a<outputs.length;a++)for(let b=a+1;b<outputs.length;b++)assert.ok(spectralDistance(outputs[a],outputs[b])>.35,'distinct vowel spectra must not collapse to one piano tone');
  }
});
test('noise and subharmonic roughness survive learning and are audible signal components in sustain',()=>{
  const rate=48000,pitch=196;let seed=7;
  const clean=voiceFixture(rate,pitch,[700,1200],false);
  const rough=clean.map((x,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return x+.08*Math.sin(2*Math.PI*pitch/2*i/rate)+.06*(seed/4294967296-.5);});
  const raw=bank(rough,rate,pitch),learned=learn(raw),reference=render(raw,pitch,rate),result=render(learned,pitch,rate);
  assert.ok(relativeError(result,reference)<.005);
  assert.ok(spectralDistance(result,render(bank(clean,rate,pitch),pitch,rate))>.03);
});
test('a long held note sustains without dropouts or replaying a whole recorded phrase',()=>{
  for(const [rate,pitch] of [[44100,110],[48000,196],[48000,330]]){
    const raw=bank(voiceFixture(rate,pitch),rate,pitch),out=render(learn(raw),pitch,rate,8);
    assert.ok(out.every(Number.isFinite));
    const levels=[];for(let i=0;i<out.length;i+=Math.round(rate*.05))levels.push(Math.sqrt(energy(out.slice(i,i+Math.round(rate*.05)))));
    assert.ok(Math.min(...levels)>Math.max(...levels)*.55,'no repeated envelope dips');
    const lag=Math.round(rate*.8),a=out.slice(0,rate),b=out.slice(lag,lag+rate);
    assert.ok(relativeError(a,b)>.01,'the recording must not restart every 0.8 seconds');
    // Strongest autocorrelation peak stays near the requested period.
    let best=-Infinity,period=0;const expected=rate/pitch;
    for(let k=Math.floor(expected*.9);k<=Math.ceil(expected*1.1);k++){
      let score=0;for(let i=0;i<4096;i++)score+=out[i]*out[i+k];
      if(score>best){best=score;period=k;}
    }
    assert.ok(Math.abs(period-expected)<2);
  }
});
test('sustain worklet stops at the requested release frame and closes its audio process',async()=>{
  const code=(await readFile(new URL('../src/sustain-processor.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
  let Processor;const messages=[];
  const ctx={SustainRenderer,sampleRate:48000,currentFrame:0,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},
    registerProcessor:(_name,value)=>{Processor=value;}};
  runInNewContext(code,ctx);
  const grains=[Float32Array.from({length:1024},(_,i)=>Math.sin(2*Math.PI*4*i/1024))];
  const processor=new Processor({processorOptions:{grains,frequency:196,seed:1}});
  processor.port.onmessage({data:{stopFrame:80}});
  const out=new Float32Array(128);
  assert.equal(processor.process([],[[out]]),true);assert.ok(energy(out.slice(0,80))>.1);assert.equal(energy(out.slice(80)),0);
  ctx.currentFrame=128;assert.equal(processor.process([],[[out]]),false);assert.deepEqual(messages,['ended']);
});
