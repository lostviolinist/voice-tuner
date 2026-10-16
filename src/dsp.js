let wasm;
export async function initDSP(bytes) {
  if (wasm) return;
  if (!bytes) {
    const response = await fetch(new URL('./voice_dsp.wasm', import.meta.url));
    if (!response.ok) throw new Error('The audio engine could not load. Reload the page to try again.');
    bytes = await response.arrayBuffer();
  }
  wasm = (await WebAssembly.instantiate(bytes)).instance.exports;
}
function run(input, outputSize, action) {
  if (!wasm) throw new Error('The Rust audio engine is still loading.');
  const inputPtr = input ? wasm.alloc_floats(input.length) : 0;
  const outputPtr = wasm.alloc_floats(outputSize);
  try {
    if (input) new Float32Array(wasm.memory.buffer,inputPtr,input.length).set(input);
    const code = action(inputPtr,outputPtr);
    if (code) throw new Error({1:'That was a little quiet. Move closer and hold a steady “ooo”.',2:'I couldn’t find a steady note. Try a sustained “ooo” without speaking or whispering.',3:'This audio format could not be analyzed. Try another recording.'}[code]);
    return new Float32Array(wasm.memory.buffer,outputPtr,outputSize).slice();
  } finally { if (input) wasm.free_floats(inputPtr,input.length); wasm.free_floats(outputPtr,outputSize); }
}
export function vowel(kind='oo',pitch=196) { return run(null,16,(_,out) => { wasm.sample_vowel({oo:0,aa:1,ee:2}[kind]??0,pitch,out); return 0; }); }
export function cycle(amplitudes) {
  if (amplitudes.length!==16) throw new Error('Expected 16 harmonics');
  return run(amplitudes,128,(input,out) => { wasm.render_cycle(input,out); return 0; });
}
export function analyze(samples,sampleRate) {
  const result=run(samples,18,(input,out)=>wasm.analyze_voice(input,samples.length,sampleRate,out));
  return {pitch:result[0],confidence:result[1],amplitudes:result.slice(2)};
}
