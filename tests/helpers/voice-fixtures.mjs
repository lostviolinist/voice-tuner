// Deterministic artificial voices: formant-like peaks, phase, pitch movement,
// and breath noise. These are not recordings of a person.
export function voiceFixture(sampleRate = 48000, pitch = 196, formants = [700, 1200], movement = true) {
  let phase = 0, seed = 71;
  const amplitudes = Float64Array.from({length:44}, (_, i) => {
    const h = i + 1, f = h * pitch;
    return .035 / h + .12 * Math.exp(-(((f - formants[0]) / 250) ** 2)) + .06 * Math.exp(-(((f - formants[1]) / 400) ** 2));
  });
  return Float32Array.from({length:sampleRate * 2}, (_, i) => {
    const t = i / sampleRate;
    phase += 2 * Math.PI * pitch * (1 + (movement ? .008 * Math.sin(2 * Math.PI * 4 * t) : 0)) / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return amplitudes.reduce((sum, a, h) => sum + a * Math.sin((h + 1) * phase + h * .7), 0) * (.9 + .1 * Math.sin(t * 8)) + (movement ? .006 * (seed / 4294967296 - .5) : 0);
  });
}
