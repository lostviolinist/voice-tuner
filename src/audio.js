import { prepareVoiceSample } from './voice-sample.js';
import { grainPlan, extractGrains, filterGrains, createSustainVoice } from './voice-grains.js';
export class AudioEngine {
  constructor() { this.voices = new Map(); this.level = .22; this.voiceCorrections = new Map(); this.voiceCorrectionEnabled = false; this.sustainCache = new Map(); this.createSustainVoice = createSustainVoice; }
  async ready() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.level;
      const limiter = this.context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 12;
      this.master.connect(limiter).connect(this.context.destination);
    }
    await this.context.resume();
    if (!this.sustainReady) this.sustainReady = this.context.audioWorklet.addModule('./sustain-processor.js').catch(error=>{this.sustainReady=null;throw error;});
    await this.sustainReady;
    return this.context;
  }
  wave(weights, frequency) {
    const real = new Float32Array(weights.length + 1), imaginary = new Float32Array(weights.length + 1);
    for (let i = 0; i < weights.length; i++) if ((i + 1) * frequency < this.context.sampleRate / 2) imaginary[i + 1] = weights[i];
    return this.context.createPeriodicWave(real, imaginary);
  }
  setVoiceRecording(recording, pitch) {
    const sample = prepareVoiceSample(recording.samples, recording.sampleRate, pitch);
    const plan = grainPlan(sample.samples, recording.sampleRate, pitch);
    const grains = extractGrains(sample.samples, plan);
    const buffer = this.context.createBuffer(1, sample.samples.length, recording.sampleRate);
    buffer.copyToChannel(sample.samples, 0);
    this.voiceSample = sample;
    this.grainPlan = plan;
    this.voiceGrains = grains;
    this.voiceBuffer = buffer;
    this.clearVoiceCorrections();
    this.learnedGrains = null;
    return this.voiceSample;
  }
  setLearnedGrains(grains) { this.learnedGrains=grains; this.sustainCache.clear(); }
  clearVoiceCorrections() { this.voiceCorrections.clear(); this.voiceCorrectionEnabled = false; this.sustainCache.clear(); }
  setVoiceCorrections(notes) {
    this.clearVoiceCorrections();
    for (const [midi, note] of notes) {
      let buffer = null;
      if (note.accepted && note.samples) {
        buffer = this.context.createBuffer(1, note.samples.length, this.voiceSample.sampleRate);
        buffer.copyToChannel(note.samples, 0);
      }
      this.voiceCorrections.set(midi, {buffer, grains:buffer ? extractGrains(note.samples,this.grainPlan) : null, weights:note.weights, centers:note.centers});
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
  clearVoiceRecording() { this.voiceSample = null; this.voiceBuffer = null; this.voiceGrains=null; this.learnedGrains=null; this.clearVoiceCorrections(); }
  grainsFor(frequency, mode) {
    const key=`${frequency}:${mode}:${this.voiceCorrectionEnabled}`;
    if (!this.sustainCache.has(key)) {
      const correction=this.voiceCorrectionFor(frequency);
      const bank=mode==='voice' ? correction?.grains || this.voiceGrains : this.learnedGrains;
      if(!bank)throw new Error('Your learned voice is not ready yet. Wait for learning to finish.');
      this.sustainCache.set(key,filterGrains(bank,frequency,this.context.sampleRate,mode==='synth' && correction?.buffer && correction.centers ? correction : null));
    }
    return this.sustainCache.get(key);
  }
  note(id, frequency, weights, mode = 'synth') {
    if (this.voices.has(id)) return;
    const gain = this.context.createGain();
    let oscillator, level = .28;
    const sustained = mode === 'voice' || (mode === 'synth' && this.voiceSample);
    if (sustained) {
      if (!this.voiceBuffer) throw new Error('Record your voice before playing this instrument.');
      oscillator = this.createSustainVoice(this.context,this.grainsFor(frequency,mode),frequency);
      level *= this.voiceSample.gain;
    } else {
      oscillator = this.context.createOscillator();
      oscillator.frequency.value = frequency; oscillator.setPeriodicWave(this.wave(weights, frequency));
    }
    gain.gain.setValueAtTime(0, this.context.currentTime); gain.gain.linearRampToValueAtTime(level, this.context.currentTime + .015);
    oscillator.connect(gain).connect(this.master); oscillator.start();
    this.voices.set(id, { oscillator, gain, frequency, mode, sustained });
  }
  update(weights) { for (const voice of this.voices.values()) if (voice.mode === 'synth' && !voice.sustained) voice.oscillator.setPeriodicWave(this.wave(weights, voice.frequency)); }
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
