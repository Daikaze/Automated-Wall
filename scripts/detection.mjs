/* Conservative image-based wall suggestion engine; no external services. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function detectRaster(image, opts={}) {
  const {width:w,height:h,data}=image;
  if (!w||!h||!data||data.length<w*h*4) throw Error("Invalid image data");
  const sensitivity=clamp(+opts.sensitivity||65,20,100);
  const min=clamp(+opts.minLength||48,15,400);
  const max=clamp(+opts.maxSegments||800,50,1500);
  const lum=new Uint8Array(w*h), mask=new Uint8Array(w*h);
  for(let i=0,j=0;i<lum.length;i++,j+=4) lum[i]=Math.round(data[j]*.299+data[j+1]*.587+data[j+2]*.114);
  const sample=opts.sampleColor;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,j=i*4;
    if(data[j+3]<50)continue;
    if(sample){
      const tol=18+sensitivity*.53;
      let d=(data[j]-sample[0])**2+(data[j+1]-sample[1])**2+(data[j+2]-sample[2])**2;
      if(d/3<=tol*tol)mask[i]=1;
    }else{
      const edge=Math.max(Math.abs(lum[i-1]-lum[i+1]),Math.abs(lum[i-w]-lum[i+w]),Math.abs(lum[i-w-1]-lum[i+w+1]),Math.abs(lum[i-w+1]-lum[i+w-1]));
      if(edge>66-sensitivity*.34)mask[i]=1;
    }
  }
  const candidates=[];
  function scan(x0,y0,dx,dy,length,direction){
    let first=-1,last=-1,hits=0;
    const flush=()=>{
      if(first>=0&&last-first+1>=min&&hits/(last-first+1)>.65)
        candidates.push({x1:x0+first*dx,y1:y0+first*dy,x2:x0+last*dx,y2:y0+last*dy,direction,score:hits});
      first=-1;last=-1;hits=0;
    };
    for(let t=0;t<length;t++){
      const x=x0+dx*t,y=y0+dy*t;
      let hit=false;
      for(let offset=-1;offset<=1;offset++){
        const xx=x-dy*offset,yy=y+dx*offset;
        if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[yy*w+xx]){hit=true;break;}
      }
      if(hit){if(first<0)first=t;last=t;hits++;}
      else if(first>=0&&t-last>3)flush();
    }
    flush();
  }
  for(let y=1;y<h-1;y+=2)scan(1,y,1,0,w-2,"h");
  for(let x=1;x<w-1;x+=2)scan(x,1,0,1,h-2,"v");
  if(opts.diagonal!==false){
    for(let x=1;x<w-1;x+=3)scan(x,1,1,1,Math.min(w-1-x,h-2),"d1");
    for(let y=4;y<h-1;y+=3)scan(1,y,1,1,Math.min(w-2,h-1-y),"d1");
    for(let x=1;x<w-1;x+=3)scan(x,1,-1,1,Math.min(x,h-2),"d2");
    for(let y=4;y<h-1;y+=3)scan(w-2,y,-1,1,Math.min(w-2,h-1-y),"d2");
  }
  const groups=new Map();
  for(const s of candidates){
    const d=s.direction;
    let p;
    if(d==="h")p={offset:s.y1,low:s.x1,high:s.x2};
    if(d==="v")p={offset:s.x1,low:s.y1,high:s.y2};
    if(d==="d1")p={offset:s.y1-s.x1,low:s.x1,high:s.x2};
    if(d==="d2")p={offset:s.y1+s.x1,low:Math.min(s.x1,s.x2),high:Math.max(s.x1,s.x2)};
    if(!groups.has(d))groups.set(d,[]);
    groups.get(d).push({...p,direction:d,score:s.score});
  }
  const out=[];
  for(const [direction,ss]of groups){
    ss.sort((a,b)=>b.score-a.score);
    const merged=[];
    for(const s of ss){
      const same=merged.find(q=>Math.abs(q.offset-s.offset)<=6&&Math.min(q.high,s.high)-Math.max(q.low,s.low)>=Math.min(8,(s.high-s.low)*.35));
      if(same){same.offset=(same.offset+s.offset)/2;same.low=Math.min(same.low,s.low);same.high=Math.max(same.high,s.high);}
      else merged.push({...s});
    }
    // Recenter paired edges of thick walls while preserving door-sized gaps.
    const centered=[];
    for(const s of merged){
      const near=centered.find(q=>{const gap=Math.abs(q.offset-s.offset),overlap=Math.min(q.high,s.high)-Math.max(q.low,s.low);return gap>6&&gap<=Math.min(17,Math.max(8,(+opts.gridPixels||60)*.2))&&overlap>=Math.min(q.high-q.low,s.high-s.low)*.75;});
      if(near){near.offset=(near.offset+s.offset)/2;near.low=Math.min(near.low,s.low);near.high=Math.max(near.high,s.high);}
      else centered.push({...s});
    }
    for(const s of centered){
      if(s.high-s.low<min)continue;
      let x1,y1,x2,y2;
      if(direction==="h"){x1=s.low;x2=s.high;y1=y2=s.offset;}
      if(direction==="v"){y1=s.low;y2=s.high;x1=x2=s.offset;}
      if(direction==="d1"){x1=s.low;x2=s.high;y1=s.low+s.offset;y2=s.high+s.offset;}
      if(direction==="d2"){x1=s.low;x2=s.high;y1=s.offset-s.low;y2=s.offset-s.high;}
      out.push({x1,y1,x2,y2,type:"wall",source:"scan",confidence:.65,score:s.score});
    }
  }
  out.sort((a,b)=>b.score-a.score);
  const truncated=out.length>max;
  const segments=out.slice(0,max).map(({score,...s})=>s);
  const suggestions=opts.suggestOpenings===false?[]:proposeOpenings(segments,+opts.gridPixels||60);
  return {segments,suggestions,truncated,stats:{walls:segments.length,openings:suggestions.length}};
}
export function proposeOpenings(segments,gridPixels=60){
  const suggestions=[];
  const min=clamp(gridPixels*.3,10,65),max=clamp(gridPixels*1.3,min+12,160);
  for(const axis of ["h","v"]){
    const horiz=axis==="h";
    const lines=segments.filter(s=>horiz?Math.abs(s.y1-s.y2)<3:Math.abs(s.x1-s.x2)<3);
    lines.sort((a,b)=>horiz?a.y1-b.y1||a.x1-b.x1:a.x1-b.x1||a.y1-b.y1);
    for(let i=0;i<lines.length;i++){
      const a=lines[i],aFixed=horiz?a.y1:a.x1,aEnd=horiz?Math.max(a.x1,a.x2):Math.max(a.y1,a.y2);
      for(let j=i+1;j<lines.length;j++){
        const b=lines[j],bFixed=horiz?b.y1:b.x1;
        if(bFixed-aFixed>6)break;
        const bStart=horiz?Math.min(b.x1,b.x2):Math.min(b.y1,b.y2),gap=bStart-aEnd;
        if(gap<min||gap>max)continue;
        const fixed=(aFixed+bFixed)/2;
        const s=horiz?{x1:aEnd,y1:fixed,x2:bStart,y2:fixed}:{x1:fixed,y1:aEnd,x2:fixed,y2:bStart};
        if(suggestions.some(t=>Math.hypot(t.x1-s.x1,t.y1-s.y1)<8))continue;
        suggestions.push({...s,type:"opening",source:"suggestion",confidence:.4});
        if(suggestions.length>=120)return suggestions;
      }
    }
  }
  return suggestions;
}
