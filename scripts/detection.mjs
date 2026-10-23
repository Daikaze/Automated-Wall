/**
 * Smart Wall Architect v0.2 — local directional structure extraction.
 * This is NOT semantic image recognition: all results remain reviewable.
 * No image content is transmitted. Detection coordinates are in raster pixels.
 */
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const dirs=[{key:'h',dx:1,dy:0},{key:'v',dx:0,dy:1},{key:'d1',dx:1,dy:1},{key:'d2',dx:-1,dy:1}];

function projection(s){
  switch(s.dir){
    case 'h':return {offset:(s.y1+s.y2)/2,low:Math.min(s.x1,s.x2),high:Math.max(s.x1,s.x2)};
    case 'v':return {offset:(s.x1+s.x2)/2,low:Math.min(s.y1,s.y2),high:Math.max(s.y1,s.y2)};
    case 'd1':return {offset:((s.y1-s.x1)+(s.y2-s.x2))/2,low:Math.min(s.x1,s.x2),high:Math.max(s.x1,s.x2)};
    default:return {offset:((s.y1+s.x1)+(s.y2+s.x2))/2,low:Math.min(s.x1,s.x2),high:Math.max(s.x1,s.x2)};
  }
}
function restore(s){
  const {low:a,high:b,offset:o,dir}=s;
  if(dir==='h')return {x1:a,y1:o,x2:b,y2:o};
  if(dir==='v')return {x1:o,y1:a,x2:o,y2:b};
  if(dir==='d1')return {x1:a,y1:a+o,x2:b,y2:b+o};
  return {x1:a,y1:o-a,x2:b,y2:o-b};
}
const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);

/** Analyze ImageData (RGBA). Scans straight structures; NOT furniture/door semantics. */
export function detectRaster(image,options={}){
  const {width:w,height:h,data}=image;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<12||h<12||!data||data.length<w*h*4)throw Error('Invalid image data');
  const sensitivity=clamp(Number(options.sensitivity??65),20,100);
  const minLength=clamp(Number(options.minLength??48),12,500);
  const maxSegments=clamp(Number(options.maxSegments??650),30,2000);
  const structural=options.mode!=='all';
  const material=options.material||'stone';
  const palette=Array.isArray(options.sampleColors)?options.sampleColors.filter(c=>Array.isArray(c)&&c.length>=3).slice(0,5):options.sampleColor?[options.sampleColor]:[];
  const roi=options.region||{x1:0,y1:0,x2:1,y2:1};
  const bounds={x0:clamp(Math.floor(Math.min(roi.x1,roi.x2)*w),0,w-1),y0:clamp(Math.floor(Math.min(roi.y1,roi.y2)*h),0,h-1),
    x1:clamp(Math.ceil(Math.max(roi.x1,roi.x2)*w),1,w),y1:clamp(Math.ceil(Math.max(roi.y1,roi.y2)*h),1,h)};
  const within=(x,y)=>x>=bounds.x0&&x<bounds.x1&&y>=bounds.y0&&y<bounds.y1;
  // First blur a little. Fine floor texture and object outlines otherwise overwhelm wall edges.
  const raw=new Float32Array(w*h),smooth=new Float32Array(w*h),colors=new Uint8Array(w*h),materialMask=new Uint8Array(w*h);
  for(let i=0,j=0;i<raw.length;i++,j+=4){
    raw[i]=.299*data[j]+.587*data[j+1]+.114*data[j+2];
    if(!within(i%w,Math.floor(i/w))||data[j+3]<65)continue;
    const r=data[j],g=data[j+1],b=data[j+2],bright=(r+g+b)/3;
    const chroma=Math.max(r,g,b)-Math.min(r,g,b);
    materialMask[i]=(material==='any'||(material==='stone'&&bright<155&&chroma<=Math.max(11,bright*.31))||
      (material==='wood'&&bright<190&&r>=g*.93&&g>=b*.87))?1:0;
    if(palette.length){
      let best=Infinity;
      for(const c of palette){
        const delta=((data[j]-c[0])**2+(data[j+1]-c[1])**2+(data[j+2]-c[2])**2)/3;
        if(delta<best)best=delta;
      }
      const tol=clamp(10+sensitivity*.39,17,54);
      if(best<tol*tol)colors[i]=1;
    }
  }
  // Separable 5x5 box smoothing, safe for a low-res 1100px raster.
  const horizontal=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0,count=0;
    for(let ox=-2;ox<=2;ox++){const xx=x+ox;if(xx>=0&&xx<w){sum+=raw[y*w+xx];count++;}}
    horizontal[y*w+x]=sum/count;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0,count=0;
    for(let oy=-2;oy<=2;oy++){const yy=y+oy;if(yy>=0&&yy<h){sum+=horizontal[yy*w+x];count++;}}
    smooth[y*w+x]=sum/count;
  }
  const lengthThreshold=clamp(23-sensitivity*.14,8,21);
  const edge={};
  const dirsUsed=options.diagonal===false?dirs.slice(0,2):dirs;
  for(const {key,dx,dy}of dirsUsed){
    const m=new Uint8Array(w*h);
    for(let y=4;y<h-4;y++)for(let x=4;x<w-4;x++){
      if(!within(x,y))continue;
      const i=y*w+x;
      // Along-direction vs perpendicular gradient: long wall edges are coherent;
      // foliage and carpets have gradient in both directions and are penalized.
      const n1=(y+dx*2)*w+(x-dy*2),n2=(y-dx*2)*w+(x+dy*2);
      const t1=(y+dy*2)*w+(x+dx*2),t2=(y-dy*2)*w+(x-dx*2);
      const cross=Math.abs(smooth[n1]-smooth[n2]),along=Math.abs(smooth[t1]-smooth[t2]);
      const aligned=cross-.70*along;
      // Restrict color mode as a mask, but retain an independent directional edge gate.
      if((palette.length?colors[i]:materialMask[i])&&aligned>lengthThreshold)m[i]=1;
    }
    edge[key]=m;
  }
  const candidates=[];
  function run(x0,y0,dx,dy,length,key){
    const mask=edge[key];let first=-1,last=-1,hits=0;
    const flush=()=>{
      if(first>=0){
        const span=last-first+1,ratio=hits/span;
        if(span>=minLength&&ratio>=.43){
          candidates.push({x1:x0+first*dx,y1:y0+first*dy,x2:x0+last*dx,y2:y0+last*dy,dir:key,
            score:Math.min(1,ratio),length:span});
        }
      }first=-1;last=-1;hits=0;
    };
    for(let t=0;t<length;t++){
      const x=x0+dx*t,y=y0+dy*t;
      if(!within(x,y)){if(first>=0)flush();continue;}
      let hit=0;
      for(let o=-2;o<=2;o++){
        const xx=x-dy*o,yy=y+dx*o;
        if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[yy*w+xx])hit++;
      }
      if(hit>=1){if(first<0)first=t;last=t;hits++;}
      else if(first>=0&&t-last>Math.max(5,Math.round(minLength*.14)))flush();
    }flush();
  }
  for(let y=bounds.y0+4;y<bounds.y1-4;y+=3)run(bounds.x0+3,y,1,0,Math.max(0,bounds.x1-bounds.x0-6),'h');
  for(let x=bounds.x0+4;x<bounds.x1-4;x+=3)run(x,bounds.y0+3,0,1,Math.max(0,bounds.y1-bounds.y0-6),'v');
  if(options.diagonal!==false){
    for(let x=bounds.x0+4;x<bounds.x1-4;x+=4)run(x,bounds.y0+3,1,1,Math.min(bounds.x1-3-x,bounds.y1-6-bounds.y0),'d1');
    for(let y=bounds.y0+7;y<bounds.y1-4;y+=4)run(bounds.x0+3,y,1,1,Math.min(bounds.x1-bounds.x0-6,bounds.y1-3-y),'d1');
    for(let x=bounds.x0+4;x<bounds.x1-4;x+=4)run(x,bounds.y0+3,-1,1,Math.min(x-bounds.x0-3,bounds.y1-bounds.y0-6),'d2');
    for(let y=bounds.y0+7;y<bounds.y1-4;y+=4)run(bounds.x1-4,y,-1,1,Math.min(bounds.x1-bounds.x0-6,bounds.y1-3-y),'d2');
  }
  // Collapse multi-row scan hits and resolve the two long parallel outer edges
  // of thick masonry walls into their physical centerline.
  const merged=[];
  const grouped=new Map(dirsUsed.map(d=>[d.key,[]]));
  for(const s of candidates)grouped.get(s.dir).push({...projection(s),dir:s.dir,score:s.score,weight:s.length});
  for(const [,items]of grouped){
    items.sort((a,b)=>b.weight-a.weight);
    const group=[];
    for(const item of items){
      const target=group.find(t=>Math.abs(t.offset-item.offset)<5 && Math.min(t.high,item.high)-Math.max(t.low,item.low)>=Math.min(t.high-t.low,item.high-item.low)*.54);
      if(target){const n=target.weight+item.weight;target.offset=(target.offset*target.weight+item.offset*item.weight)/n;target.low=Math.min(target.low,item.low);target.high=Math.max(target.high,item.high);target.score=Math.max(target.score,item.score);target.weight=n;}
      else group.push({...item});
    }
    const centers=[];
    const edgeSep=clamp(Number(options.gridPixels??60)*.27,8,23);
    for(const item of group.sort((a,b)=>b.weight-a.weight)){
      const near=centers.find(t=>{const d=Math.abs(t.offset-item.offset),over=Math.min(t.high,item.high)-Math.max(t.low,item.low);return d>=5&&d<=edgeSep&&over>Math.min(t.high-t.low,item.high-item.low)*.8;});
      if(near){near.offset=(near.offset+item.offset)/2;near.low=Math.min(near.low,item.low);near.high=Math.max(near.high,item.high);near.score=Math.max(near.score,item.score);near.paired=true;}
      else centers.push({...item,paired:false});
    }
    for(const s of centers)if(s.high-s.low>=minLength)merged.push({...restore(s),dir:s.dir,paired:s.paired,score:s.score,length:s.high-s.low});
  }
  // Architectural wall networks are connected at T/corner junctions.
  // Penalize isolated lines (tables, carpets and random outdoor vegetation).
  function junctions(s){
    let n=0;
    for(const t of merged){
      if(t===s)continue;
      const endpoints=[[s.x1,s.y1],[s.x2,s.y2]];
      const vx=t.x2-t.x1,vy=t.y2-t.y1,den=vx*vx+vy*vy||1;
      for(const [x,y]of endpoints){
        const q=clamp(((x-t.x1)*vx+(y-t.y1)*vy)/den,0,1);
        if(dist(x,y,t.x1+vx*q,t.y1+vy*q)<=10){n++;break;}
      }
      if(n>=3)return n;
    }
    return n;
  }
  const ranked=merged.map(s=>({...s,junctions:junctions(s)}));
  const filtered=ranked.filter(s=>{
    if(!structural)return true;
    if(s.paired)return true;
    if(s.junctions>=1&&s.score>=.52)return true;
    if(s.length>=minLength*2.6&&s.score>=.70)return true;
    return false;
  });
  // Strictly cap output, preserve score for UI inspection.
  filtered.sort((a,b)=>(b.paired?1:0)-(a.paired?1:0)||b.junctions-a.junctions||b.length-a.length);
  const selected=filtered.slice(0,maxSegments).map(s=>({x1:s.x1,y1:s.y1,x2:s.x2,y2:s.y2,type:'wall',source:'scan',
    confidence:clamp(.25+.17*s.junctions+.26*Number(s.paired)+.2*s.score,.2,.95)}));
  const proposals=options.suggestOpenings===false?[]:proposeOpenings(selected,{gridPixels:Number(options.gridPixels??60)});
  return {segments:selected,suggestions:proposals,truncated:filtered.length>maxSegments,
    stats:{raw:candidates.length,candidates:merged.length,filtered:merged.length-filtered.length,walls:selected.length,openings:proposals.length}};
}

export function proposeOpenings(segments,{gridPixels=60,maxProposals=120}={}){
  const out=[],min=clamp(gridPixels*.3,10,65),max=clamp(gridPixels*1.3,min+12,160);
  for(const horizontal of [true,false]){
    const lines=segments.filter(s=>horizontal?Math.abs(s.y1-s.y2)<3:Math.abs(s.x1-s.x2)<3)
      .sort((a,b)=>horizontal?a.y1-b.y1||a.x1-b.x1:a.x1-b.x1||a.y1-b.y1);
    for(let i=0;i<lines.length;i++){
      const a=lines[i],fixed=horizontal?a.y1:a.x1,stop=horizontal?Math.max(a.x1,a.x2):Math.max(a.y1,a.y2);
      for(let j=i+1;j<lines.length;j++){
        const b=lines[j],bFixed=horizontal?b.y1:b.x1;
        if(bFixed-fixed>8)break;
        const start=horizontal?Math.min(b.x1,b.x2):Math.min(b.y1,b.y2);
        if(start-stop<min||start-stop>max)continue;
        const v=(fixed+bFixed)/2;
        const s=horizontal?{x1:stop,y1:v,x2:start,y2:v}:{x1:v,y1:stop,x2:v,y2:start};
        if(out.some(t=>dist(t.x1,t.y1,s.x1,s.y1)<8&&dist(t.x2,t.y2,s.x2,s.y2)<8))continue;
        out.push({...s,type:'opening',source:'suggestion',confidence:.3});
        if(out.length>=maxProposals)return out;
      }
    }
  }
  return out;
}