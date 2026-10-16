class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(Math.ceil(sampleRate * 2)); this.offset = 0; this.sent = false; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && !this.sent) {
      const n = Math.min(channel.length, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(0, n), this.offset); this.offset += n;
      if (this.offset === this.buffer.length) { this.sent = true; this.port.postMessage(this.buffer, [this.buffer.buffer]); }
    }
    return !this.sent;
  }
}
registerProcessor('capture', Capture);
