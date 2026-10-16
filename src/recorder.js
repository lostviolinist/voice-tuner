class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(Math.ceil(sampleRate * 2)); this.offset = 0; this.sent = false; this.nextUpdate = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && !this.sent) {
      const n = Math.min(channel.length, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(0, n), this.offset); this.offset += n;
      if (this.offset >= this.nextUpdate) {
        let energy = 0;
        for (let i = 0; i < n; i++) energy += channel[i] * channel[i];
        this.port.postMessage({ type: 'progress', elapsed: this.offset / sampleRate, level: Math.sqrt(energy / n) });
        this.nextUpdate = this.offset + sampleRate / 10;
      }
      if (this.offset === this.buffer.length) { this.sent = true; this.port.postMessage({ type: 'complete', samples: this.buffer }, [this.buffer.buffer]); }
    }
    return !this.sent;
  }
}
registerProcessor('capture', Capture);
