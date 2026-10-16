import { Circuit } from './vendor/numeric-ui-core.js';
import { fft } from './fft.js';

// Learn both signed Fourier components of actual short voice segments. By
// Parseval's identity this spectral squared error is equivalent to waveform
// squared error (excluding DC and Nyquist), without a huge dense sine graph.
export class RecordedModel {
  constructor(grain) {
    this.size=grain.length; this.count=this.size-2;
    const real=Float64Array.from(grain), imag=new Float64Array(this.size); fft(real,imag);
    this.source=new Float32Array(this.count*2);
    this.circuit=new Circuit(this.source.length);
    const errors=[];
    for(let bin=1;bin<this.size/2;bin++){
      this.source[this.count+(bin-1)*2]=2*real[bin]/this.size;
      this.source[this.count+(bin-1)*2+1]=-2*imag[bin]/this.size;
    }
    for(let i=0;i<this.count;i++){
      const difference=this.circuit.affine([[this.circuit.source(i),1],[this.circuit.source(this.count+i),-1]]);
      errors.push([this.circuit.multiply(difference,difference),.5]);
    }
    this.lossWire=this.circuit.affine(errors); this.steps=0;
  }
  get weights(){return this.source.subarray(0,this.count);}
  loss(){return this.circuit.evaluateReference(this.source)[this.lossWire];}
  train(){
    const values=this.circuit.evaluateReference(this.source),seed=new Float32Array(values.length);seed[this.lossWire]=1;
    const gradients=this.circuit.backpropagateReference(values,seed);
    for(let i=0;i<this.count;i++)this.source[i]-=.2*gradients[i];
    this.steps++;
  }
  render(){
    const real=new Float64Array(this.size),imag=new Float64Array(this.size);
    for(let bin=1;bin<this.size/2;bin++){
      real[bin]=real[this.size-bin]=this.weights[(bin-1)*2]*this.size/2;
      imag[bin]=-this.weights[(bin-1)*2+1]*this.size/2; imag[this.size-bin]=-imag[bin];
    }
    fft(real,imag,true);return Float32Array.from(real);
  }
}
