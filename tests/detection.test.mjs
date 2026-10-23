import test from "node:test";
import assert from "node:assert/strict";
import {detectRaster,proposeOpenings} from "../scripts/detection.mjs";
test("detects a sampled-color straight wall",()=>{
  const width=160,height=100,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,wall=y>=35&&y<=39&&x>=12&&x<=145;
    data[i]=data[i+1]=data[i+2]=wall?20:240;data[i+3]=255;
  }
  const r=detectRaster({width,height,data},{sampleColor:[20,20,20],minLength:30,diagonal:false});
  assert.ok(r.segments.some(s=>Math.abs(s.y1-s.y2)<3&&s.x2-s.x1>95));
});
test("proposes gaps without auto-applying them",()=>{
  const segments=[{x1:5,y1:20,x2:35,y2:20},{x1:65,y1:20,x2:120,y2:20}];
  const p=proposeOpenings(segments,60);
  assert.ok(p.some(s=>s.type==="opening"&&s.x1===35&&s.x2===65));
});
