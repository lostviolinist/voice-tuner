import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { AudioEngine } from '../src/audio.js';

test('worklet reports input level and captures exactly two seconds once', async () => {
  const messages=[]; let Processor;
  runInNewContext(await readFile(new URL('../src/recorder.js',import.meta.url),'utf8'), {
    AudioWorkletProcessor:class { constructor(){this.port={postMessage:data=>messages.push(data)};} },
    sampleRate:44100,Float32Array,Math,registerProcessor:(_,processor)=>{Processor=processor;},
  });
  const processor=new Processor();
  for(let i=0;i<700;i++) processor.process([[new Float32Array(128).fill(.25)]]);
  const complete=messages.filter(message=>message.type==='complete');
  const progress=messages.filter(message=>message.type==='progress');
  assert.equal(complete.length,1); assert.equal(complete[0].samples.length,88200);
  assert.ok(complete[0].samples.every(sample=>sample===.25));
  assert.ok(progress.length>=19 && progress.length<=21);
  assert.ok(progress.every((message,i)=>message.level===.25 && message.elapsed<=2 && (!i || message.elapsed>progress[i-1].elapsed)));
});

test('capture stops microphone tracks and disconnects on success or failure', async () => {
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const oldNode=globalThis.AudioWorkletNode;
  try {
    for(const fail of [false,true]) {
      let stopped=0, disconnected=0, resumed=0, progress=0, started=0;
      const node=()=>({connect(destination){return destination;},disconnect(){disconnected++;}});
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
      globalThis.AudioWorkletNode=class {
        constructor(){this.port={close(){}};}
        connect(destination){
          assert.equal(started,1); assert.equal(resumed,1);
          this.port.onmessage({data:{type:'progress',elapsed:1,level:.25}});
          setTimeout(()=>this.port.onmessage({data:{type:'complete',samples:new Float32Array(96000)}}),0);
          return destination;
        }
        disconnect(){disconnected++;}
      };
      const context={sampleRate:48000,resume:async()=>{resumed++;},audioWorklet:{addModule:async()=>{if(fail)throw new Error('module failure');}},createMediaStreamSource:node,createGain:()=>({...node(),gain:{value:1}}),destination:{}};
      const engine=new AudioEngine(); engine.ready=async()=>context;
      if(fail) await assert.rejects(()=>engine.record(()=>{}),/module failure/);
      else {
        const recording=await engine.record(()=>{started++;},data=>{progress++;assert.equal(data.level,.25);});
        assert.equal(recording.samples.length,96000);assert.equal(recording.sampleRate,48000);
        assert.equal(progress,1);assert.equal(disconnected,3);
      }
      assert.equal(stopped,1);
    }
  } finally {
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator); else delete globalThis.navigator;
    if(oldNode)globalThis.AudioWorkletNode=oldNode; else delete globalThis.AudioWorkletNode;
  }
});
