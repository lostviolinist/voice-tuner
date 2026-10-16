import { RecordedModel } from './recorded-model.js';
self.onmessage=({data:{grains}})=>{
  try{
    const learned=[],coefficients=[];let before=0,after=0;
    for(let i=0;i<grains.length;i++){
      const model=new RecordedModel(grains[i]);before+=model.loss();
      for(let step=0;step<64;step++)model.train();
      after+=model.loss();learned.push(model.render());coefficients.push(Array.from(model.weights));
      self.postMessage({type:'progress',done:i+1,total:grains.length,preview:learned[i],target:grains[i]});
    }
    self.postMessage({type:'complete',grains:learned,coefficients,before,after});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
