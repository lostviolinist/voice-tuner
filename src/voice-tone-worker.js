import { prepareToneTraining, trainVoiceNote } from './voice-tone.js';

self.onmessage = ({data:voice}) => {
  try {
    const prepared = prepareToneTraining(voice);
    const low = Math.max(21, voice.rootMidi - 12), high = Math.min(108, voice.rootMidi + 12);
    let before = 0, after = 0, accepted = 0;
    for (let midi = low; midi <= high; midi++) {
      const result = trainVoiceNote(prepared, midi);
      before += result.before; after += result.after; accepted += Number(result.accepted);
      self.postMessage({type:'note', ...result, centers:Array.from(prepared.centers), done:midi - low + 1, total:high - low + 1}, result.samples ? [result.samples.buffer] : []);
    }
    self.postMessage({type:'complete', low, high, accepted, before:before / (high - low + 1), after:after / (high - low + 1)});
  } catch (error) { self.postMessage({type:'error', message:error.message}); }
};
