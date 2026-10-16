import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Exercise the actual UI preview and key handlers together, with audio output
// captured instead of playing sound. No microphone or browser permission needed.
const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function harness() {
  const notes = [], buttons = new Map();
  const context = {
    notes, busy:false, recorded:{}, audition:null, epoch:0, auditionTimer:null,
    playbackMode:'voice', autoSelectLearned:false, pitch:205,
    model:{weights:[.7,.2,.1]}, target:[.1,.8,.1], held:new Map(),
    audio:{ready:async()=>{}, voiceSample:{rootFrequency:207.65234878997256}, learnedGrains:[[]],
      note:(id, frequency, weights, mode)=>notes.push({id,frequency,weights,mode}),
      playRecording:async()=>{}},
    $:id=>{if(!buttons.has(id))buttons.set(id,{classList:{add(){}},addEventListener(_event,handler){this.click=handler;}});return buttons.get(id);},
    setTimeout:()=>1, clearTimeout(){}, status(message){throw new Error(message);},
    refreshKey(){}, showVoiceNote(){}, stopAudition(){context.audition=null;},
    silence(){context.epoch++;context.held.clear();context.audition=null;},
    updatePlaybackUI(){context.selected=context.playbackMode;},
    frequencyFor:midi=>440*2**((midi-69)/12),
  };
  runInNewContext(
    section('function setPlaybackMode(', '\nfunction ') + '\n' +
    section('async function listen(', '\nconst frequencyFor') + '\n' +
    section('async function startNote(', '\nfunction stopNote('), context);
  return {context, notes, buttons};
}

test('learned preview selects the synth for the next piano key at the same tuned pitch',async()=>{
  const {context:c,notes,buttons}=harness();
  await buttons.get('listen-synth').click();
  await c.startNote(56,'key');
  assert.equal(c.selected,'synth');
  assert.equal(notes.length,2);
  assert.equal(notes[0].mode,'synth');
  assert.equal(notes[1].mode,'synth');
  assert.equal(notes[0].frequency,notes[1].frequency);
  assert.deepEqual(notes[0].weights,notes[1].weights);
});
test('voice preview selects Voice for subsequent piano keys; comparisons preserve that choice',async()=>{
  const {context:c,notes,buttons}=harness();c.playbackMode='synth';
  await buttons.get('listen-voice').click();
  await buttons.get('listen-original').click();
  await buttons.get('listen-target').click();
  await c.startNote(60,'key');
  assert.equal(c.selected,'voice');
  assert.equal(notes.at(-1).mode,'voice');
});
test('pressing an active preview again stops it without retriggering or changing the piano',async()=>{
  const {context:c,notes,buttons}=harness();
  await buttons.get('listen-synth').click();
  await buttons.get('listen-synth').click();
  assert.equal(c.audition,null);
  assert.equal(notes.length,1);
  assert.equal(c.playbackMode,'synth');
});
test('a new mode choice cancels a preview still waiting for audio startup',async()=>{
  const {context:c,notes,buttons}=harness();let ready;
  c.audio.ready=()=>new Promise(resolve=>{ready=resolve;});
  const preview=buttons.get('listen-synth').click();
  c.setPlaybackMode('voice');ready();await preview;
  assert.equal(notes.length,0);
  assert.equal(c.playbackMode,'voice');
});

test('the piano waits for the new recorded model instead of playing a stale or unrelated synth',async()=>{
  const {context:c,notes}=harness();c.audio.learnedGrains=null;
  await c.startNote(60,'key');
  assert.equal(notes.length,0);assert.equal(c.held.size,0);
  c.audio.learnedGrains=[[]];c.playbackMode='synth';
  await c.startNote(60,'key');assert.equal(notes.length,1);assert.equal(notes[0].mode,'synth');
});
