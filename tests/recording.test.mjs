import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { AudioEngine } from '../src/audio.js';

test('worklet captures exactly two seconds and posts once', async () => {
  const messages=[]; let Processor;
  runInNewContext(await readFile(new URL('../src/recorder.js',import.meta.url),'utf8'), {
    AudioWorkletProcessor:class { constructor(){this.port={postMessage:data=>messages.push(data)};} },
    sampleRate:44100,Float32Array,Math,registerProcessor:(_,processor)=>{Processor=processor;},
  });
  const processor=new Processor();
  for(let i=0;i<700;i++) processor.process([[new Float32Array(128).fill(.25)]]);
  assert.equal(messages.length,1); assert.equal(messages[0].length,88200);
  assert.ok(messages[0].every(sample=>sample===.25));
});

test('capture stops microphone tracks and disconnects on success or failure', async () => {
  const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const oldNode=globalThis.AudioWorkletNode;
  try {
    for(const fail of [false,true]) {
      let stopped=0, disconnected=0;
      const node=()=>({connect(){return this;},disconnect(){disconnected++;}});
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
      globalThis.AudioWorkletNode=class { constructor(){this.port={close(){}}; setTimeout(()=>this.port.onmessage?.({data:new Float32Array(96000)}),0);} connect(){return this;} disconnect(){disconnected++;} };
      const context={sampleRate:48000,audioWorklet:{addModule:async()=>{if(fail)throw new Error('module failure');}},createMediaStreamSource:node,createGain:()=>({...node(),gain:{value:1}}),destination:{}};
      const engine=new AudioEngine(); engine.ready=async()=>context;
      if(fail) await assert.rejects(()=>engine.record(()=>{}),/module failure/);
      else {const recording=await engine.record(()=>{});assert.equal(recording.samples.length,96000);assert.equal(disconnected,3);}
      assert.equal(stopped,1);
    }
  } finally {
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator); else delete globalThis.navigator;
    if(oldNode)globalThis.AudioWorkletNode=oldNode; else delete globalThis.AudioWorkletNode;
  }
});
