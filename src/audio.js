export class AudioEngine {
  constructor() { this.voices = new Map(); this.level = .22; }
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
  note(id, frequency, weights) {
    if (this.voices.has(id)) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.frequency.value = frequency; oscillator.setPeriodicWave(this.wave(weights, frequency));
    gain.gain.setValueAtTime(0, this.context.currentTime); gain.gain.linearRampToValueAtTime(.28, this.context.currentTime + .035);
    oscillator.connect(gain).connect(this.master); oscillator.start();
    this.voices.set(id, { oscillator, gain, frequency });
  }
  update(weights) { for (const voice of this.voices.values()) voice.oscillator.setPeriodicWave(this.wave(weights, voice.frequency)); }
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
  async record(onStart) {
    const context = await this.ready();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost. You can still use the sample sounds.');
    let stream, source, capture, silence, timer;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!this.workletLoaded) { await context.audioWorklet.addModule('./recorder.js'); this.workletLoaded = true; }
      source = context.createMediaStreamSource(stream);
      capture = new AudioWorkletNode(context, 'capture');
      silence = context.createGain(); silence.gain.value = 0;
      source.connect(capture).connect(silence).connect(context.destination);
      onStart();
      const samples = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Recording timed out. Please try again.')), 6000);
        capture.port.onmessage = event => resolve(event.data);
        capture.onprocessorerror = () => reject(new Error('Audio capture failed. Please try again.'));
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
