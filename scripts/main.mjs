import {detectRaster} from "./detection.mjs";
const ID="smart-wall-architect";
const color={wall:"#f5c454",door:"#bd90ff",window:"#65d9f6",opening:"#ff8aab"};
let editor=null;
const $=(r,q)=>r.querySelector(q);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gm=()=>!!game.user?.isGM;
const clamp=(n,a,b)=>Math.max(a,Math.min(n,b));
function openArchitect(){
  if(!gm())return ui.notifications.warn("Smart Wall Architect: GM only");
  if(!canvas?.scene)return ui.notifications.warn("Open a Scene first");
  if(editor?.root?.isConnected){editor.root.style.zIndex=String(Number(editor.root.style.zIndex||3000)+1);return;}
  editor=new Architect(canvas.scene);editor.open();
}
Hooks.on("getSceneControlButtons",controls=>{
  if(!gm())return;
  if(Array.isArray(controls)){
    const group=controls.find(t=>t.name==="walls");
    if(group&&!group.tools.some(t=>t.name===ID))group.tools.push({name:ID,title:"Smart Wall Architect",icon:"fas fa-draw-polygon",button:true,onClick:openArchitect});
  }else{
    const group=controls?.walls;
    if(group?.tools&&!group.tools[ID])group.tools[ID]={name:ID,title:"Smart Wall Architect",icon:"fa-solid fa-draw-polygon",button:true,order:1000,visible:true,onChange:openArchitect};
  }
});
Hooks.once("ready",()=>{const m=game.modules.get(ID);if(m)m.api={open:openArchitect};});
class Architect{
  constructor(scene){this.scene=scene;this.lines=[];this.sel=-1;this.image=null;this.imageURL=null;this.sample=null;this.mode="select";this.start=null;this.busy=false;}
  open(){
    const root=document.createElement("section");
    root.id="swa-window";root.className="swa-window";
    root.setAttribute("role","dialog");root.setAttribute("aria-label","Smart Wall Architect");
    root.innerHTML=[
      '<header class="swa-header"><div><strong>Smart Wall Architect</strong><small>v0.1.0 | V11 / V14 | GM Only</small></div><button data-action="close" title="Close">✕</button></header>',
      '<div class="swa-content"><main class="swa-main"><div class="swa-row"><b>Scene: ',esc(this.scene.name),'</b>',
      '<label class="swa-file">Local image<input id="swa-file" type="file" accept="image/png,image/jpeg,image/webp"></label>',
      '<button data-action="scene">Scene background</button></div>',
      '<div class="swa-preview"><canvas id="swa-canvas"></canvas><div id="swa-empty">Loading image...</div></div>',
      '<p class="swa-legend"><span style="color:#f5c454">━━ Wall</span> <span style="color:#bd90ff">━━ Door</span> <span style="color:#65d9f6">━━ Window</span> <span style="color:#ff8aab">┄ Review opening</span></p>',
      '<p id="swa-counter">0 segments</p></main>',
      '<aside class="swa-side"><h3>Auto Detection</h3>',
      '<label>Sensitivity <output id="swa-sens-o">65</output><input id="swa-sens" type="range" min="20" max="100" step="5" value="65"></label>',
      '<label>Minimum line length <output id="swa-min-o">48</output><input id="swa-min" type="range" min="20" max="160" step="4" value="48"></label>',
      '<label class="swa-check"><input id="swa-diag" type="checkbox" checked> 45° diagonals</label>',
      '<label class="swa-check"><input id="swa-openings" type="checkbox" checked> Suggest openings</label>',
      '<button class="swa-primary" data-action="scan">Analyze Image</button>',
      '<button data-action="sample">Sample wall color</button>',
      '<p id="swa-sample-text" class="swa-help">Optional: pick the wall color on the map, then rescan.</p>',
      '<h3>Review and Edit</h3><label>Tool<select id="swa-tool">',
      '<option value="select">Select</option><option value="wall">Draw Wall</option><option value="door">Draw Door</option><option value="window">Draw Window</option><option value="erase">Erase</option></select></label>',
      '<label>Selected segment<select id="swa-type" disabled><option value="wall">Wall</option><option value="door">Door</option><option value="window">Window</option><option value="opening">Review proposal (skip)</option></select></label>',
      '<div class="swa-row"><button data-action="delete">Delete selected</button><button data-action="clear">Clear draft</button></div>',
      '<p class="swa-help">Pink proposed openings are NEVER applied until you set their type to Door, Window or Wall.</p>',
      '<h3>Scene Safety</h3><label class="swa-check"><input type="checkbox" checked disabled> Preserve existing walls</label>',
      '<label class="swa-check"><input id="swa-dedupe" type="checkbox" checked> Skip duplicates</label>',
      '<button data-action="backup">Download wall backup</button>',
      '<button class="swa-primary" data-action="apply">Apply Reviewed Walls</button>',
      '<button data-action="undo">Undo Last Module Batch</button>',
      '<p id="swa-status" role="status">No scene changes made.</p></aside></div>'
    ].join("");
    document.body.appendChild(root);this.root=root;
    this.canvas=$(root,"#swa-canvas");this.ctx=this.canvas.getContext("2d");
    this.attach();
    this.loadScene().catch(e=>this.fail(e));
  }
  status(s){$(this.root,"#swa-status").textContent=s;}
  fail(e){console.error(ID,e);this.status(String(e?.message||e));ui.notifications.error("Smart Wall Architect: "+String(e?.message||e));}
  close(){if(this.imageURL)URL.revokeObjectURL(this.imageURL);this.root.remove();if(editor===this)editor=null;}
  attach(){
    const root=this.root;
    root.addEventListener("click",async e=>{
      const b=e.target.closest("[data-action]");if(!b||this.busy)return;
      const a=b.dataset.action;
      try{
        if(a==="close")return this.close();
        if(a==="scene")return await this.loadScene();
        if(a==="scan")return await this.scan();
        if(a==="sample"){this.sampling=true;this.status("Click a wall color in the image.");return;}
        if(a==="delete"){if(this.sel>=0)this.lines.splice(this.sel,1);this.sel=-1;return this.draw();}
        if(a==="clear"){this.lines=[];this.sel=-1;this.draw();return this.status("Draft cleared. Scene untouched.");}
        if(a==="backup")return this.backup();
        if(a==="apply")return await this.apply();
        if(a==="undo")return await this.undo();
      }catch(err){this.fail(err);}
    });
    $(root,"#swa-file").addEventListener("change",async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{
        if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error("Select PNG, JPG or WebP");
        if(this.imageURL)URL.revokeObjectURL(this.imageURL);
        this.imageURL=URL.createObjectURL(file);await this.load(this.imageURL);
      }catch(err){this.fail(err);}
    });
    for(const [id,out]of [["swa-sens","swa-sens-o"],["swa-min","swa-min-o"]])
      $(root,"#"+id).addEventListener("input",e=>{$(root,"#"+out).textContent=e.target.value;});
    $(root,"#swa-type").addEventListener("change",e=>{
      if(this.lines[this.sel]){this.lines[this.sel].type=e.target.value;this.draw();}
    });
    $(root,"#swa-tool").addEventListener("change",e=>{this.mode=e.target.value;});
    this.canvas.addEventListener("pointerdown",e=>this.pointerDown(e));
    this.canvas.addEventListener("pointermove",e=>this.pointerMove(e));
    this.canvas.addEventListener("pointerup",e=>this.pointerUp(e));
    this.canvas.addEventListener("pointercancel",()=>{this.start=null;this.draw();});
    const h=$(root,".swa-header");
    h.addEventListener("pointerdown",e=>{
      if(e.target.closest("button"))return;
      const box=root.getBoundingClientRect(),dx=e.clientX-box.left,dy=e.clientY-box.top;
      h.setPointerCapture(e.pointerId);
      const move=p=>{root.style.left=Math.max(0,p.clientX-dx)+"px";root.style.top=Math.max(0,p.clientY-dy)+"px";root.style.transform="none";};
      const up=()=>{h.removeEventListener("pointermove",move);h.removeEventListener("pointerup",up);};
      h.addEventListener("pointermove",move);h.addEventListener("pointerup",up,{once:true});
    });
  }
  async loadScene(){
    const src=this.scene.background?.src||this.scene.img;
    if(!src)throw Error("This Scene has no raster background. Use Local image.");
    await this.load(src);
  }
  async load(src){
    const image=new Image();image.crossOrigin="anonymous";
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error("Image could not load. Try Local image instead."));image.src=src;});
    this.image=image;this.lines=[];this.sel=-1;this.sample=null;
    const width=820,height=Math.max(100,Math.round(820*image.naturalHeight/image.naturalWidth));
    this.canvas.width=width;this.canvas.height=height;
    $(this.root,"#swa-empty")?.remove();this.draw();
    this.status("Image loaded. Click Analyze Image to scan.");
  }
  draw(){
    if(!this.image)return;
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height;
    c.clearRect(0,0,w,h);c.drawImage(this.image,0,0,w,h);
    c.save();c.lineCap="round";
    this.lines.forEach((s,i)=>{
      c.beginPath();c.moveTo(s.x1*w,s.y1*h);c.lineTo(s.x2*w,s.y2*h);
      c.strokeStyle=color[s.type]||"#fff";c.lineWidth=i===this.sel?5:3;
      c.setLineDash(s.type==="opening"?[7,6]:[]);c.stroke();
    });c.restore();
    const kinds={wall:0,door:0,window:0,opening:0};
    for(const s of this.lines)kinds[s.type]++;
    $(this.root,"#swa-counter").textContent=Object.entries(kinds).map(([k,n])=>k+": "+n).join(" | ");
    const type=$(this.root,"#swa-type");type.disabled=this.sel<0;
    if(this.lines[this.sel])type.value=this.lines[this.sel].type;
  }
  point(e){
    const r=this.canvas.getBoundingClientRect();
    return {x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};
  }
  nearest(p){
    let index=-1,closest=12,w=this.canvas.width,h=this.canvas.height;
    this.lines.forEach((s,i)=>{
      const ax=s.x1*w,ay=s.y1*h,bx=s.x2*w,by=s.y2*h,px=p.x*w,py=p.y*h;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy||1;
      const t=clamp(((px-ax)*dx+(py-ay)*dy)/den,0,1);
      const d=Math.hypot(px-ax-t*dx,py-ay-t*dy);
      if(d<closest){closest=d;index=i;}
    });return index;
  }
  pointerDown(e){
    if(!this.image||e.button!==0)return;
    const p=this.point(e);
    if(this.sampling){
      const c=document.createElement("canvas");c.width=c.height=1;
      const context=c.getContext("2d",{willReadFrequently:true});
      try{
        context.drawImage(this.image,Math.floor(p.x*(this.image.naturalWidth-1)),Math.floor(p.y*(this.image.naturalHeight-1)),1,1,0,0,1,1);
        this.sample=Array.from(context.getImageData(0,0,1,1).data).slice(0,3);
        $(this.root,"#swa-sample-text").textContent="RGB("+this.sample.join(", ")+") sampled. Rescan to use.";
        this.status("Color sampled. Run Analyze Image again.");
      }catch(err){this.fail(err);}this.sampling=false;return;
    }
    if(this.mode==="select"||this.mode==="erase"){
      this.sel=this.nearest(p);
      if(this.mode==="erase"&&this.sel>=0){this.lines.splice(this.sel,1);this.sel=-1;}
      this.draw();return;
    }
    this.start={...p,mode:this.mode};this.canvas.setPointerCapture(e.pointerId);
  }
  pointerMove(e){
    if(!this.start)return;
    this.draw();const p=this.point(e),s=this.start,c=this.ctx,w=this.canvas.width,h=this.canvas.height;
    c.beginPath();c.moveTo(s.x*w,s.y*h);c.lineTo(p.x*w,p.y*h);
    c.strokeStyle=color[s.mode];c.lineWidth=3;c.stroke();
  }
  pointerUp(e){
    if(!this.start)return;const p=this.point(e),s=this.start;this.start=null;
    if(Math.hypot((p.x-s.x)*this.canvas.width,(p.y-s.y)*this.canvas.height)<5)return this.draw();
    this.lines.push({x1:s.x,y1:s.y,x2:p.x,y2:p.y,type:s.mode,source:"manual"});
    this.sel=this.lines.length-1;this.draw();
  }
  async scan(){
    if(!this.image)throw Error("Load an image first.");
    this.busy=true;
    try{
      // Downscale expensive artistic rasters for UI responsiveness.
      const w=Math.min(800,this.image.naturalWidth),h=Math.max(12,Math.round(w*this.image.naturalHeight/this.image.naturalWidth));
      const off=document.createElement("canvas");off.width=w;off.height=h;
      const c=off.getContext("2d",{willReadFrequently:true});c.drawImage(this.image,0,0,w,h);
      const rgba=c.getImageData(0,0,w,h);
      const gridPixels=(Number(this.scene.grid?.size||this.scene.grid||100)/Number(this.scene.width||this.image.naturalWidth))*w;
      const result=detectRaster(rgba,{sensitivity:+$(this.root,"#swa-sens").value,minLength:+$(this.root,"#swa-min").value,
        diagonal:$(this.root,"#swa-diag").checked,suggestOpenings:$(this.root,"#swa-openings").checked,sampleColor:this.sample,gridPixels});
      this.lines=[...result.segments,...result.suggestions].map(s=>({...s,x1:s.x1/w,x2:s.x2/w,y1:s.y1/h,y2:s.y2/h}));
      this.sel=-1;this.draw();
      this.status("Scan: "+result.stats.walls+" walls, "+result.stats.openings+" possible openings. Review before applying."+(result.truncated?" Segment limit reached.":""));
    }finally{this.busy=false;}
  }
  wallObject(s){
    const d=this.scene.dimensions??this.scene.getDimensions();
    const sw=Number(d.sceneWidth||this.scene.width),sh=Number(d.sceneHeight||this.scene.height);
    const x=Number(d.sceneX||0)+Number(this.scene.background?.offsetX||0),y=Number(d.sceneY||0)+Number(this.scene.background?.offsetY||0);
    const c=[s.x1*sw+x,s.y1*sh+y,s.x2*sw+x,s.y2*sh+y].map(Math.round);
    if(Math.hypot(c[2]-c[0],c[3]-c[1])<8)return null;
    const data={c,move:1,sight:1,light:1,sound:1,dir:0,door:0,ds:0,flags:{[ID]:{generated:true,type:s.type}}};
    if(s.type==="door")data.door=1;
    if(s.type==="window"){data.sight=0;data.light=0;data.sound=0;}
    return data;
  }
  static duplicate(a,b){
    const p=a.c,q=b.c;if(!q)return false;
    const near=(i,j)=>Math.hypot(p[i]-q[j],p[i+1]-q[j+1])<7;
    return (near(0,0)&&near(2,2))||(near(0,2)&&near(2,0));
  }
  async apply(){
    if(!gm()||canvas.scene?.id!==this.scene.id)throw Error("GM access to the original Scene required.");
    const all=Array.from(this.scene.walls,w=>w.toObject()),docs=[];
    for(const line of this.lines){
      if(line.type==="opening")continue;
      const wall=this.wallObject(line);if(!wall)continue;
      if($(this.root,"#swa-dedupe").checked&&[...all,...docs].some(other=>Architect.duplicate(wall,other)))continue;
      docs.push(wall);
    }
    if(!docs.length)throw Error("No new accepted walls. Review or draw segments first.");
    if(!window.confirm("Add "+docs.length+" walls to "+this.scene.name+"? Existing Scene walls will remain unchanged."))return;
    this.busy=true;
    try{
      const created=await this.scene.createEmbeddedDocuments("Wall",docs);
      await this.scene.setFlag(ID,"lastBatch",{ids:created.map(x=>x.id),timestamp:Date.now()});
      this.status("Created "+created.length+" walls. Undo Last Module Batch is available.");
      ui.notifications.info("Smart Wall Architect added "+created.length+" walls.");
    }finally{this.busy=false;}
  }
  async undo(){
    if(!gm()||canvas.scene?.id!==this.scene.id)throw Error("GM access to the original Scene required.");
    const batch=this.scene.getFlag(ID,"lastBatch"),ids=(batch?.ids||[]).filter(id=>this.scene.walls.get(id));
    if(!ids.length)throw Error("There is no module batch to undo.");
    if(!window.confirm("Delete "+ids.length+" walls created in the last module batch?"))return;
    this.busy=true;
    try{
      await this.scene.deleteEmbeddedDocuments("Wall",ids);
      await this.scene.unsetFlag(ID,"lastBatch");
      this.status("Undid "+ids.length+" walls.");
    }finally{this.busy=false;}
  }
  backup(){
    const walls=Array.from(this.scene.walls,w=>w.toObject());
    const data=JSON.stringify({module:ID,version:"0.1.0",sceneId:this.scene.id,walls},null,2);
    const uri=URL.createObjectURL(new Blob([data],{type:"application/json"}));
    const a=document.createElement("a");a.href=uri;a.download="swa-"+this.scene.id+"-backup.json";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(uri),1000);
    this.status("Exported backup of "+walls.length+" walls.");
  }
}
