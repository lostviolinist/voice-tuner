import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardLayout, typedNote, keyCode } from '../src/keyboard-layout.js';

test('wide layout reaches every semitone from C3 to C8 without switching octave', () => {
  const layout = keyboardLayout();
  const reached = new Set(layout.bindings.flatMap(b => b.sharp === null ? [b.midi] : [b.midi,b.sharp]));
  assert.deepEqual([...reached].sort((a,b)=>a-b), Array.from({length:61},(_,i)=>48+i));
  assert.equal(new Set(layout.bindings.map(b=>b.code)).size,36);
});
test('Chopin opening shortcuts produce the melody in its original key', () => {
  const phrase = [['e',true],['o'],['o'],['i'],['o'],['i'],['y',true],['e',true],['o']];
  assert.deepEqual(phrase.map(([key,shift])=>typedNote(keyboardLayout(),keyCode(key),shift)),[70,79,79,77,79,77,75,70,79]);
});
test('Shift uses physical digit keys and keeps E/B on their natural notes', () => {
  const layout = keyboardLayout();
  assert.equal(typedNote(layout,'Digit1',true),49);
  assert.equal(typedNote(layout,'Digit3',true),52);
  assert.equal(typedNote(layout,'Digit7',true),59);
  assert.equal(typedNote(layout,'KeyM',true),108);
  assert.equal(typedNote(layout,'Space'),null);
});
test('both layouts stay inside the piano and classic shortcuts remain intact', () => {
  for (const mode of ['wide','classic']) for (const octave of [-3,1,3,4,7,10]) {
    const layout=keyboardLayout(mode,octave);
    assert.ok(layout.bindings.every(b=>b.midi>=21 && b.midi<=108 && (b.sharp===null || b.sharp<=108)));
  }
  const classic=keyboardLayout('classic',4);
  assert.equal(typedNote(classic,'KeyA'),60);
  assert.equal(typedNote(classic,'KeyW'),61);
  assert.equal(typedNote(classic,'KeyK'),72);
});
