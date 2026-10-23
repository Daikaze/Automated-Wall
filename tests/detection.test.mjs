import test from 'node:test';
import assert from 'node:assert/strict';
import {detectRaster, proposeOpenings} from '../scripts/detection.mjs';

const makeImage=(w,h,background=[191,181,162])=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let p=0;p<data.length;p+=4){data[p]=background[0];data[p+1]=background[1];data[p+2]=background[2];data[p+3]=255;}
  const pixel=(x,y,c=[35,31,34])=>{
    if(x<0||x>=w||y<0||y>=h)return;
    const i=(y*w+x)*4;data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2];
  };
  const line=(x1,y1,x2,y2,c=[35,31,34],thickness=3)=>{
    const len=Math.hypot(x2-x1,y2-y1);
    for(let step=0;step<=len*2;step++){
      const t=step/(len*2),x=Math.round(x1+t*(x2-x1)),y=Math.round(y1+t*(y2-y1));
      for(let ox=-thickness;ox<=thickness;ox++)for(let oy=-thickness;oy<=thickness;oy++)pixel(x+ox,y+oy,c);
    }
  };
  return {image:{width:w,height:h,data},line};
};

test('detects long horizontal and vertical wall candidates from a contrasting map',()=>{
  const {image,line}=makeImage(320,220);
  line(28,32,286,32);line(28,32,28,194);line(286,32,286,194);line(28,194,286,194);
  const r=detectRaster(image,{sensitivity:70,minLength:32,diagonal:false,gridPixels:40});
  assert.ok(r.stats.walls>=4,`expected at least four walls, got ${r.stats.walls}`);
  assert.ok(r.segments.some(s=>Math.abs(s.y1-32)<9 && Math.abs(s.y2-32)<9 && Math.abs(s.x2-s.x1)>160),'top wall detected');
  assert.ok(r.segments.some(s=>Math.abs(s.x1-28)<9 && Math.abs(s.x2-28)<9 && Math.abs(s.y2-s.y1)>95),'left wall detected');
});

test('detects wall-color samples (alternative to edge detection)',()=>{
  const {image,line}=makeImage(250,150);
  line(25,70,220,70,[82,40,32]);
  const r=detectRaster(image,{sampleColor:[82,40,32],minLength:30,diagonal:false});
  assert.ok(r.segments.some(s=>Math.abs(s.y1-70)<9 && Math.abs(s.x2-s.x1)>100));
});

test('opening proposals remain advisory, never assigned a door type automatically',()=>{
  const candidates=[{x1:10,y1:35,x2:90,y2:35,type:'wall'},{x1:130,y1:35,x2:230,y2:35,type:'wall'}];
  const proposals=proposeOpenings(candidates,{gridPixels:60});
  assert.equal(proposals.length,1);
  assert.equal(proposals[0].type,'opening');
  assert.equal(proposals[0].x1,90);
  assert.equal(proposals[0].x2,130);
});

test('invalid data rejected',()=>{
  assert.throws(()=>detectRaster({width:3,height:3,data:new Uint8Array(36)}),/Invalid/);
});

test('ROI scan excludes lines outside the selected building',()=>{
 const {image,line}=makeImage(400,280);
 line(15,30,385,30);line(15,220,385,220);line(15,30,15,220);line(385,30,385,220);
 line(125,90,260,90);line(125,90,125,155);line(260,90,260,155);
 const r=detectRaster(image,{sensitivity:70,minLength:20,diagonal:false,region:{x1:.22,y1:.22,x2:.75,y2:.7},gridPixels:35});
 assert.ok(r.segments.length>0,'interior candidate generated');
 assert.ok(r.segments.every(s=>s.x1>=80&&s.x2<=301&&s.y1>=60&&s.y2<=200),'no exterior walls in ROI');
});

test('capped output and no automatic door or window classifications',()=>{
 const {image,line}=makeImage(320,220);line(30,30,300,30);line(30,30,30,180);line(300,30,300,180);line(30,180,300,180);
 const r=detectRaster(image,{maxSegments:30,minLength:15});
 assert.ok(r.segments.length<=30);
 assert.ok(r.segments.every(s=>s.type==='wall'));
 assert.ok(r.suggestions.every(s=>s.type==='opening'));
});