import { SustainRenderer } from './voice-grains.js';
class VoiceSustain extends AudioWorkletProcessor {
  constructor({processorOptions}) {
    super();
    this.renderer=new SustainRenderer(processorOptions.grains,processorOptions.frequency,sampleRate,processorOptions.seed);
    this.stopFrame=Infinity;
    this.port.onmessage=({data})=>{this.stopFrame=data.stopFrame;};
  }
  process(_inputs,outputs) {
    const output=outputs[0][0];
    if(currentFrame>=this.stopFrame){this.port.postMessage('ended');return false;}
    this.renderer.process(output);
    for(let i=0;i<output.length;i++) if(currentFrame+i>=this.stopFrame) output[i]=0;
    return true;
  }
}
registerProcessor('voice-sustain',VoiceSustain);
