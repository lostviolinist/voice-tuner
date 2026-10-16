export class VoiceToneTrainer {
  constructor(onUpdate, createWorker = () => new Worker(new URL('./voice-tone-worker.js', import.meta.url), {type:'module'})) {
    this.onUpdate = onUpdate;
    this.createWorker = createWorker;
  }
  cancel() {
    clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = null;
  }
  start(voice) {
    this.cancel();
    const notes = new Map();
    try {
      const worker = this.createWorker();
      this.worker = worker;
      const fail = () => {
        if (this.worker !== worker) return;
        this.cancel(); this.onUpdate({state:'error'});
      };
      worker.onerror = fail;
      worker.onmessage = ({data}) => {
        if (this.worker !== worker) return;
        if (data.type === 'note') {
          notes.set(data.midi, data);
          this.onUpdate({state:'learning', done:data.done, total:data.total});
        } else if (data.type === 'complete') {
          this.cancel(); this.onUpdate({state:'ready', ...data, notes});
        } else if (data.type === 'error') fail();
      };
      this.onUpdate({state:'learning', done:0, total:Math.min(108, voice.rootMidi + 12) - Math.max(21, voice.rootMidi - 12) + 1});
      this.timeout = setTimeout(fail, 45000);
      // Structured cloning leaves the recording available for immediate play.
      worker.postMessage(voice);
    } catch {
      this.cancel(); this.onUpdate({state:'error'});
    }
  }
}
