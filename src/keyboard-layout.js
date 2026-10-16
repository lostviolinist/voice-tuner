const whiteSteps = [0, 2, 4, 5, 7, 9, 11];
const wideKeys = '1234567890qwertyuiopasdfghjklzxcvbnm';
const classicKeys = ['a','w','s','e','d','f','t','g','y','h','u','j','k'];
export const keyCode = key => /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
export function keyboardLayout(mode = 'wide', octave = 3) {
  const maxOctave = mode === 'wide' ? 3 : 7;
  octave = Math.max(1, Math.min(maxOctave, octave));
  const base = (octave + 1) * 12;
  const bindings = Array.from(mode === 'wide' ? wideKeys : classicKeys, (key, index) => {
    const midi = base + (mode === 'wide' ? Math.floor(index / 7) * 12 + whiteSteps[index % 7] : index);
    const sharp = mode === 'wide' && [0,2,5,7,9].includes(midi % 12) && midi < 108 ? midi + 1 : null;
    return { key, code:keyCode(key), midi, sharp };
  });
  return { octave, maxOctave, base, end:bindings.at(-1).midi, bindings };
}
export function typedNote(layout, code, shift = false) {
  const binding = layout.bindings.find(binding => binding.code === code);
  return binding ? (shift && binding.sharp !== null ? binding.sharp : binding.midi) : null;
}
export const pianoNoteName = midi => ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'][midi % 12] + (Math.floor(midi / 12) - 1);
