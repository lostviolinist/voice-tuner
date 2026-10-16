import { prepareVoiceSample, samplePlaybackRate } from './voice-sample.js';
export class AudioEngine {
  constructor() { this.voices = new Map(); this.level = .22; this.voiceCorrections = new Map(); this.voiceCorrectionEnabled = false; }
  async ready() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.level;
      const limiter = this.context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 12;
      this.master.connect(limiter).connect(this.context.destination);
    }
    await this.context.resume(); return this.context;
  }
  wave(weights, frequency) {
    const real = new Float32Array(weights.length + 1), imaginary = new Float32Array(weights.length + 1);
    for (let i = 0; i < weights.length; i++) if ((i + 1) * frequency < this.context.sampleRate / 2) imaginary[i + 1] = weights[i];
    return this.context.createPeriodicWave(real, imaginary);
  }
  setVoiceRecording(recording, pitch) {
    this.voiceSample = prepareVoiceSample(recording.samples, recording.sampleRate, pitch);
    this.clearVoiceCorrections();
    this.voiceBuffer = this.context.createBuffer(1, this.voiceSample.samples.length, recording.sampleRate);
    this.voiceBuffer.copyToChannel(this.voiceSample.samples, 0);
    return this.voiceSample;
  }
  clearVoiceCorrections() { this.voiceCorrections.clear(); this.voiceCorrectionEnabled = false; }
  setVoiceCorrections(notes) {
    this.clearVoiceCorrections();
    for (const [midi, note] of notes) {
      let buffer = null;
      if (note.accepted && note.samples) {
        buffer = this.context.createBuffer(1, note.samples.length, this.voiceSample.sampleRate);
        buffer.copyToChannel(note.samples, 0);
      }
      this.voiceCorrections.set(midi, {buffer});
    }
    this.voiceCorrectionEnabled = Array.from(this.voiceCorrections.values()).some(note => note.buffer);
  }
  voiceCorrectionFor(frequency) {
    if (!this.voiceCorrectionEnabled) return null;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    // Only use the filter at the exact piano pitch it was trained for.
    if (Math.abs(1200 * Math.log2(frequency / (440 * 2 ** ((midi - 69) / 12)))) > .1) return null;
    return this.voiceCorrections.get(midi) || null;
  }
  clearVoiceRecording() { this.voiceSample = null; this.voiceBuffer = null; this.clearVoiceCorrections(); }
  note(id, frequency, weights, mode = 'synth') {
    if (this.voices.has(id)) return;
    const gain = this.context.createGain();
    let oscillator, level = .28;
    if (mode === 'voice') {
      if (!this.voiceBuffer) throw new Error('Record your voice before choosing Voice mode.');
      oscillator = this.context.createBufferSource(); oscillator.buffer = this.voiceCorrectionFor(frequency)?.buffer || this.voiceBuffer; oscillator.loop = true;
      oscillator.playbackRate.value = samplePlaybackRate(this.voiceSample, frequency);
      level *= this.voiceSample.gain;
    } else {
      oscillator = this.context.createOscillator();
      oscillator.frequency.value = frequency; oscillator.setPeriodicWave(this.wave(weights, frequency));
    }
    gain.gain.setValueAtTime(0, this.context.currentTime); gain.gain.linearRampToValueAtTime(level, this.context.currentTime + .015);
    oscillator.connect(gain).connect(this.master); oscillator.start();
    this.voices.set(id, { oscillator, gain, frequency, mode });
  }
  update(weights) { for (const voice of this.voices.values()) if (voice.mode === 'synth') voice.oscillator.setPeriodicWave(this.wave(weights, voice.frequency)); }
  stop(id) {
    const voice = this.voices.get(id); if (!voice) return;
    voice.gain.gain.cancelScheduledValues(this.context.currentTime);
    voice.gain.gain.setTargetAtTime(0, this.context.currentTime, .025);
    voice.oscillator.stop(this.context.currentTime + .15);
    voice.oscillator.onended = () => { voice.oscillator.disconnect(); voice.gain.disconnect(); };
    this.voices.delete(id);
  }
  stopAll() { for (const id of this.voices.keys()) this.stop(id); }
  volume(value) { this.level = value; if (this.master) this.master.gain.setTargetAtTime(value, this.context.currentTime, .02); }
  async record(onStart, onProgress = () => {}) {
    const context = await this.ready();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost. You can still use the sample sounds.');
    let stream, source, capture, silence, timer;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      // Permission prompts can suspend audio after the initial user gesture.
      await context.resume();
      if (!this.workletLoaded) { await context.audioWorklet.addModule('./recorder.js'); this.workletLoaded = true; }
      source = context.createMediaStreamSource(stream);
      capture = new AudioWorkletNode(context, 'capture');
      silence = context.createGain(); silence.gain.value = 0;
      const samples = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('No audio arrived from the microphone. Check your browser’s microphone input and try again.')), 6000);
        capture.port.onmessage = ({ data }) => {
          if (data.type === 'progress') onProgress(data);
          else if (data.type === 'complete') resolve(data.samples);
        };
        capture.onprocessorerror = () => reject(new Error('Audio capture failed. Please try again.'));
        onStart();
        source.connect(capture).connect(silence).connect(context.destination);
      });
      return { samples, sampleRate: context.sampleRate };
    } finally {
      clearTimeout(timer); stream?.getTracks().forEach(track => track.stop());
      source?.disconnect(); capture?.disconnect(); capture?.port.close(); silence?.disconnect();
    }
  }
  async playRecording(samples, sampleRate) {
    const context = await this.ready(); this.stopRecording();
    const buffer = context.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource(); source.buffer = buffer;
    this.recording = source;
    source.connect(this.master); source.start();
    source.onended = () => { source.disconnect(); if (this.recording === source) this.recording = null; };
  }
  stopRecording() { if (this.recording) { try { this.recording.stop(); } catch {} this.recording.disconnect(); this.recording = null; } }
}
