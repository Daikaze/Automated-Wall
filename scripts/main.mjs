import { detectRaster } from './detection.mjs';

const ID='smart-wall-architect';
const COLORS={wall:'#f6c65b',door:'#bc8cff',window:'#59d6f8',opening:'#fa7e9d'};
let active=null;
const major=()=>Number(game.version?.split('.')[0] || game.release?.generation || 11);
const isGM=()=>Boolean(game.user?.isGM);
const $=(root,selector)=>root.querySelector(selector);
const escapeHTML=(value)=>String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));

Hooks.on('getSceneControlButtons', controls=>{
  if (!isGM()) return;
  if (Array.isArray(controls)) {  // Foundry V11
    const wall=controls.find(control=>control.name==='walls');
    if (!wall || wall.tools.some(tool=>tool.name==='smart-wall-architect')) return;
    wall.tools.push({name:'smart-wall-architect',title:'Smart Wall Architect',icon:'fas fa-draw-polygon',button:true,onClick:openArchitect});
  } else { // Foundry V14
    const wall=controls?.walls;
    if (!wall?.tools || wall.tools['smart-wall-architect']) return;
    wall.tools['smart-wall-architect']={name:'smart-wall-architect',title:'Smart Wall Architect',icon:'fa-solid fa-draw-polygon',button:true,
      order:Object.keys(wall.tools).length,visible:true,onChange:()=>openArchitect()};
  }
});
Hooks.once('ready',()=>{
  const module=game.modules.get(ID);
  if (module) module.api={open:openArchitect};
});

function openArchitect() {
  if (!isGM()) {ui.notifications.warn('Smart Wall Architect is GM-only.');return;}
  if (!canvas?.scene) {ui.notifications.warn('Open a Scene first.');return;}
  if (active && active.root.isConnected) {active.root.style.zIndex=String((Number(active.root.style.zIndex)||2000)+1);return;}
  active=new ArchitectWindow(canvas.scene);
  active.open();
}

class ArchitectWindow {
  constructor(scene) {
    this.scene=scene;
    this.root=null;
    this.image=null;
    this.blobUrl=null;
    this.segments=[];
    this.selected=-1;
    this.drawStart=null;
    this.previewWidth=0;
    this.previewHeight=0;
    this.sourceWidth=0;
    this.sourceHeight=0;
    this.zoom=100;
    this.sampleColors=[];
    this.scanArea=null;
    this.selectingArea=false;
    this.chainAnchor=null;
    this.busy=false;
  }
  open() {
    const root=document.createElement('section');
    root.id='swa-window'; root.className='swa-window'; root.setAttribute('role','dialog');root.setAttribute('aria-label','Smart Wall Architect');
    root.innerHTML=`
      <header class="swa-titlebar" data-drag><div class="swa-brand"><i class="fas fa-draw-polygon"></i>
        <div><strong>Smart Wall Architect</strong><small>v0.2.0 · Foundry V${major()} · GM only</small></div></div>
        <button class="swa-icon" data-action="close" aria-label="Close"><i class="fas fa-times"></i></button></header>
      <div class="swa-body">
        <div class="swa-main">
          <div class="swa-toolbar"><span id="swa-scene">Scene: ${escapeHTML(this.scene.name)}</span>
            <div class="swa-toolbar-actions"><label class="swa-file-btn"><i class="fas fa-image"></i> Local image<input type="file" accept="image/png,image/jpeg,image/webp" id="swa-file"></label>
              <button data-action="sceneImage"><i class="fas fa-sync"></i> Scene background</button></div></div>
          <div class="swa-preview-wrap" id="swa-preview-wrap"><canvas id="swa-preview"></canvas><div class="swa-empty" id="swa-empty">Loading scene background…</div></div>
          <div class="swa-bottom"><span id="swa-count">0 walls · 0 reviewed openings</span>
            <label>Zoom <input id="swa-zoom" type="range" min="100" max="350" step="25" value="100"><output id="swa-zoom-value">100%</output></label></div>
          <div class="swa-legend"><span><i style="--c:${COLORS.wall}"></i> Wall</span><span><i style="--c:${COLORS.door}"></i> Door</span>
            <span><i style="--c:${COLORS.window}"></i> Window</span><span><i style="--c:${COLORS.opening}"></i> Review opening</span></div>
        </div>
        <aside class="swa-options">
          <div class="swa-group"><h3><i class="fas fa-wand-magic-sparkles"></i> Auto Detection</h3>
            <label class="swa-field">Map material<select id="swa-material"><option value="stone">Stone walls (castle / dungeon)</option><option value="wood">Wooden walls</option><option value="any">Any material (noisier)</option></select></label>
            <label class="swa-field">Detection preset<select id="swa-profile"><option value="structure">Structural (recommended)</option><option value="all">Detailed / All lines</option></select></label>
            <label class="swa-field">Sensitivity <output id="swa-sense-value">65</output>
              <input type="range" id="swa-sensitivity" min="20" max="100" step="5" value="65"></label>
            <label class="swa-field">Minimum segment (scan pixels) <output id="swa-min-value">48</output>
              <input type="range" id="swa-min" min="20" max="160" step="4" value="48"></label>
            <label class="swa-check"><input type="checkbox" id="swa-diagonal"> Scan 45° diagonals (may add noise)</label>
            <label class="swa-check"><input type="checkbox" id="swa-suggest" checked> Suggest gaps as openings</label>
            <div class="swa-row"><button data-action="setArea">Select building area</button><button data-action="clearArea">Full map</button></div>
            <button class="swa-primary" data-action="scan"><i class="fas fa-search"></i> Analyze Selected Area</button>
            <div class="swa-row"><button data-action="sample">Add wall color</button><button data-action="clearSample">Clear colors</button></div>
            <p class="swa-help" id="swa-sample-label">No wall color sampled. Select a stone/wood WALL, not grass, furniture or floor.</p>
          </div>
          <div class="swa-group"><h3><i class="fas fa-pen-ruler"></i> Preview Editor</h3>
            <label class="swa-field">Tool<select id="swa-tool"><option value="select">Select / change type</option>
              <option value="wall">Draw wall</option><option value="chain">Connected Wall Chain (click corners)</option><option value="door">Draw door</option><option value="window">Draw window</option><option value="erase">Delete segment</option></select></label>
            <label class="swa-field">Selected segment<select id="swa-kind">
              <option value="wall">Wall</option><option value="door">Door</option><option value="window">Window</option>
              <option value="opening">Opening proposal (not applied)</option></select></label>
            <div class="swa-row"><button data-action="delete">Delete selected</button><button data-action="endChain">Finish chain</button></div>
            <button data-action="clear">Clear draft</button>
            <p class="swa-help">Select a colored line to edit it. Chain: click consecutive corners, right-click / Esc to finish. Drag to draw separate walls, doors or windows. Proposed openings are excluded until changed to Door, Window, or Wall.</p>
          </div>
          <div class="swa-group"><h3><i class="fas fa-shield-alt"></i> Scene Safety</h3>
            <label class="swa-check"><input type="checkbox" checked disabled> Preserve existing walls</label>
            <label class="swa-check"><input type="checkbox" checked id="swa-skip"> Skip duplicate walls</label>
            <button data-action="backup"><i class="fas fa-file-export"></i> Download existing walls backup</button>
            <button class="swa-primary" data-action="apply"><i class="fas fa-check"></i> Apply Reviewed Walls</button>
            <button data-action="undo"><i class="fas fa-undo"></i> Undo Last Module Batch</button>
          </div>
          <div class="swa-message" role="status" id="swa-status">No changes have been made to the Scene.</div>
        </aside>
      </div>`;
    document.body.appendChild(root);
    this.root=root;
    this.canvas=$ (root,'#swa-preview');
    this.context=this.canvas.getContext('2d');
    this.previewWrap=$(root,'#swa-preview-wrap');
    this.setupEvents();
    this.loadSceneBackground().catch(e=>this.reportError(e));
  }
  status(message,mode='info') {const el=$(this.root,'#swa-status');el.textContent=message;el.dataset.mode=mode;}
  close() {
    this.observer?.disconnect();
    if(this._keyHandler)document.removeEventListener('keydown',this._keyHandler);
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.root?.remove();if(active===this)active=null;
  }
  setupEvents() {
    const root=this.root;
    root.addEventListener('click',async event=>{
      const button=event.target.closest('[data-action]'); if(!button || this.busy) return;
      const action=button.dataset.action;
      try {
        if(action==='close') return this.close();
        if(action==='sceneImage') return await this.loadSceneBackground();
        if(action==='scan') return await this.scan();
        if(action==='setArea') {this.selectingArea=true;this.chainAnchor=null;this.status('Drag a rectangle around ONLY the building or room to scan.');return;}
        if(action==='clearArea'){this.selectingArea=false;this.scanArea=null;this.draw();return this.status('Scan area reset to entire image.');}
        if(action==='clearSample'){this.sampleColors=[];$(root,'#swa-sample-label').textContent='No wall color sampled (edge detection).';return this.status('Color filter cleared. Rescan to apply.');}
        if(action==='endChain'){this.chainAnchor=null;this.draw();return this.status('Wall chain completed.');}
        if(action==='sample') {$(root,'#swa-tool').value='select';this.chainAnchor=null;this.sampling=true;this.status('Click on the MASONRY or WOOD wall itself. Avoid grass, floors and furniture.');return;}
        if(action==='clear') {this.segments=[];this.selected=-1;this.chainAnchor=null;this.draw();return this.status('Draft cleared. Existing Scene walls untouched.');}
        if(action==='delete') {if(this.selected>=0)this.segments.splice(this.selected,1);this.selected=-1;this.draw();return;}
        if(action==='backup') return this.backup();
        if(action==='apply') return await this.apply();
        if(action==='undo') return await this.undo();
      } catch(e) {this.reportError(e);}
    });
    $(root,'#swa-file').addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try {
        if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('Choose a PNG, JPG, or WebP image.');
        if(this.blobUrl)URL.revokeObjectURL(this.blobUrl);
        this.blobUrl=URL.createObjectURL(file);
        await this.loadImage(this.blobUrl,`Local: ${file.name}`);
      }catch(e){this.reportError(e);}
    });
    for(const [range,out] of [['#swa-sensitivity','#swa-sense-value'],['#swa-min','#swa-min-value'],['#swa-zoom','#swa-zoom-value']]){
      $(root,range).addEventListener('input',event=>{
        const value=event.target.value;$(root,out).textContent=value+(range==='#swa-zoom'?'%':'');
        if(range==='#swa-zoom'){this.zoom=Number(value);this.updateCanvasSize();}
      });
    }
    $(root,'#swa-tool').addEventListener('change',()=>{this.chainAnchor=null;this.draw();});
    this.canvas.addEventListener('contextmenu',event=>{if(this.chainAnchor){event.preventDefault();this.chainAnchor=null;this.draw();this.status('Wall chain completed.');}});
    this._keyHandler=event=>{if(event.key==='Escape'){this.chainAnchor=null;this.selectingArea=false;this.draw();}};
    document.addEventListener('keydown',this._keyHandler);
    $(root,'#swa-kind').addEventListener('change',event=>{
      if(this.selected>=0 && this.segments[this.selected]){
        this.segments[this.selected].type=event.target.value;this.segments[this.selected].source='reviewed';this.draw();
      }
    });
    this.canvas.addEventListener('pointerdown',event=>this.startPointer(event));
    this.canvas.addEventListener('pointerup',event=>this.endPointer(event));
    this.canvas.addEventListener('pointercancel',()=>{this.drawStart=null;});
    this.canvas.addEventListener('pointermove',event=>this.movePointer(event));
    // Drag frame without interfering with form controls.
    const header=$(root,'.swa-titlebar');
    header.addEventListener('pointerdown',event=>{
      if(event.target.closest('button'))return;
      const rect=root.getBoundingClientRect();const start={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      header.setPointerCapture(event.pointerId);
      const move=e=>{root.style.left=`${clamp(start.left+e.clientX-start.x,0,window.innerWidth-80)}px`;
        root.style.top=`${clamp(start.top+e.clientY-start.y,0,window.innerHeight-45)}px`;root.style.transform='none';};
      const stop=()=>{header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',stop);header.removeEventListener('pointercancel',stop);};
      header.addEventListener('pointermove',move);header.addEventListener('pointerup',stop);header.addEventListener('pointercancel',stop);
    });
    if(typeof ResizeObserver!=='undefined'){
      this.observer=new ResizeObserver(()=>this.updateCanvasSize());
      this.observer.observe(this.previewWrap);
    }
  }
  reportError(e) {console.error(`${ID}:`,e);this.status(e?.message||String(e),'error');ui.notifications?.error(`Smart Wall Architect: ${e?.message||e}`);}
  async loadSceneBackground() {
    const src=this.scene.background?.src ?? this.scene.background?.texture?.src;
    if(!src)throw new Error('This scene has no raster background. Choose Local image instead.');
    await this.loadImage(src,'Scene background');
  }
  async loadImage(src,label) {
    this.status(`Loading ${label}…`);
    const img=new Image();img.crossOrigin='anonymous';img.decoding='async';
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Could not load the image. Try Local image; some remote hosts block image pixel access.'));img.src=src;});
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('Raster map image required. Video backgrounds are not supported.');
    this.image=img;this.sourceWidth=img.naturalWidth;this.sourceHeight=img.naturalHeight;
    this.previewWidth=Math.min(1400,this.sourceWidth);
    this.previewHeight=Math.max(1,Math.round(this.previewWidth*this.sourceHeight/this.sourceWidth));
    this.canvas.width=this.previewWidth;this.canvas.height=this.previewHeight;
    this.segments=[];this.selected=-1;this.sampleColors=[];this.scanArea=null;this.chainAnchor=null;
    $(this.root,'#swa-empty').hidden=true;
    $(this.root,'#swa-sample-label').textContent='Using generic image edges (no color sample).';
    this.updateCanvasSize();this.draw();
    this.status(`${label} loaded (${this.sourceWidth}×${this.sourceHeight}). Click Analyze Image.`);
  }
  updateCanvasSize() {
    if(!this.image)return;
    const wrapWidth=Math.max(150,(this.previewWrap.clientWidth||800)-8);
    const fit=Math.min(1,wrapWidth/this.previewWidth);
    this.canvas.style.width=`${Math.round(this.previewWidth*fit*this.zoom/100)}px`;
    this.canvas.style.height=`${Math.round(this.previewHeight*fit*this.zoom/100)}px`;
  }
  async scan() {
    if(!this.image)throw new Error('Load a map first.');
    this.busy=true;this.status('Scanning local image pixels…');await waitFrame();
    try {
      const maxSide=1100,scale=Math.min(1,maxSide/Math.max(this.sourceWidth,this.sourceHeight));
      const w=Math.max(12,Math.round(this.sourceWidth*scale)),h=Math.max(12,Math.round(this.sourceHeight*scale));
      const scratch=document.createElement('canvas');scratch.width=w;scratch.height=h;
      const ctx=scratch.getContext('2d',{willReadFrequently:true});ctx.drawImage(this.image,0,0,w,h);
      let data;
      try{data=ctx.getImageData(0,0,w,h);}catch(e){throw new Error('Image pixel access blocked by CORS. Select the same map using Local image.');}
      const settings={sensitivity:Number($(this.root,'#swa-sensitivity').value),minLength:Number($(this.root,'#swa-min').value),
        diagonal:$(this.root,'#swa-diagonal').checked,gridPixels:((this.scene.grid?.size||this.scene.grid||100)/this.scene.width)*w,
        sampleColors:this.sampleColors,region:this.scanArea,mode:$(this.root,'#swa-profile').value,material:$(this.root,'#swa-material').value,
        suggestOpenings:$(this.root,'#swa-suggest').checked,maxSegments:180};
      // Future worker support can be added without changing this pure detector.
      const result=detectRaster(data,settings);
      const normalized=s=>({...s,x1:s.x1/w,y1:s.y1/h,x2:s.x2/w,y2:s.y2/h});
      const keep=this.segments.filter(s=>s.source==='manual'||s.source==='reviewed');
      this.segments=[...keep,...result.segments,...result.suggestions].map(s=>s.source==='scan'||s.source==='suggestion'?normalized(s):s);
      this.selected=-1;this.draw();
      let message=`Scan complete: ${result.stats.walls} wall candidates, ${result.stats.openings} possible openings, ${result.stats.filtered} noisy lines rejected. ${this.scanArea?'Building area only.':'Use Select building area to exclude exterior decorations.'} Review before applying.`;
      if(result.truncated)message+=' Segment limit reached; increase minimum length to reduce noise.';
      this.status(message,'success');
    } finally {this.busy=false;}
  }
  draw() {
    if(!this.canvas||!this.image)return;
    const ctx=this.context,w=this.canvas.width,h=this.canvas.height;
    ctx.clearRect(0,0,w,h);ctx.drawImage(this.image,0,0,w,h);
    ctx.save();ctx.lineCap='round';
    this.segments.forEach((s,index)=>{
      const selected=index===this.selected;
      ctx.beginPath();ctx.moveTo(s.x1*w,s.y1*h);ctx.lineTo(s.x2*w,s.y2*h);
      ctx.strokeStyle=COLORS[s.type]||'#eee';ctx.lineWidth=selected?6:3;
      ctx.setLineDash(s.type==='opening'?[9,6]:[]);ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=selected?5:3;ctx.stroke();
      if(selected){ctx.setLineDash([]);ctx.fillStyle='#fff';
        for(const [x,y] of [[s.x1*w,s.y1*h],[s.x2*w,s.y2*h]]){ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}}
    });ctx.restore();
    if(this.scanArea){const a=this.scanArea;ctx.save();ctx.strokeStyle='#54ec99';ctx.lineWidth=2;ctx.setLineDash([9,5]);ctx.strokeRect(a.x1*w,a.y1*h,(a.x2-a.x1)*w,(a.y2-a.y1)*h);ctx.setLineDash([]);ctx.restore();}
    if(this.drawStart?.mode==='area'){const a=this.drawStart.point,b=this.drawStart.current||a;ctx.save();ctx.setLineDash([7,5]);ctx.strokeStyle='#54ec99';ctx.lineWidth=2;ctx.strokeRect(a.x*w,a.y*h,(b.x-a.x)*w,(b.y-a.y)*h);ctx.restore();}
    if(this.chainAnchor){ctx.save();ctx.fillStyle='#51ffad';ctx.beginPath();ctx.arc(this.chainAnchor.x*w,this.chainAnchor.y*h,5,0,Math.PI*2);ctx.fill();ctx.restore();}
    const counts={wall:0,door:0,window:0,opening:0};for(const s of this.segments)counts[s.type]=(counts[s.type]||0)+1;
    $(this.root,'#swa-count').textContent=`${counts.wall} walls · ${counts.door} doors · ${counts.window} windows · ${counts.opening} review openings`;
    $(this.root,'#swa-kind').disabled=this.selected<0;
    if(this.selected>=0)$(this.root,'#swa-kind').value=this.segments[this.selected].type;
  }
  position(event) {
    const rect=this.canvas.getBoundingClientRect();
    return {x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
  }
  findNearest(point) {
    const ww=this.canvas.width,hh=this.canvas.height;
    let nearest=-1,distance=11;
    this.segments.forEach((s,index)=>{
      const ax=s.x1*ww,ay=s.y1*hh,bx=s.x2*ww,by=s.y2*hh,px=point.x*ww,py=point.y*hh;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy||1;
      const t=clamp(((px-ax)*dx+(py-ay)*dy)/den,0,1);
      const dist=Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
      if(dist<distance){distance=dist;nearest=index;}
    });return nearest;
  }
  snapPoint(p){
    const w=this.canvas.width,h=this.canvas.height;let best=p,lowest=11;
    for(const s of this.segments)for(const endpoint of [{x:s.x1,y:s.y1},{x:s.x2,y:s.y2}]){
      const d=Math.hypot((p.x-endpoint.x)*w,(p.y-endpoint.y)*h);
      if(d<lowest){best=endpoint;lowest=d;}
    }
    return best;
  }
  startPointer(event) {
    if(!this.image||event.button!==0)return;
    const p=this.position(event);
    if(this.sampling){
      const ctx=document.createElement('canvas');ctx.width=1;ctx.height=1;
      const c=ctx.getContext('2d',{willReadFrequently:true});
      try {
        const sx=Math.min(this.sourceWidth-1,Math.round(p.x*(this.sourceWidth-1)));
        const sy=Math.min(this.sourceHeight-1,Math.round(p.y*(this.sourceHeight-1)));
        c.drawImage(this.image,sx,sy,1,1,0,0,1,1);
        const rgba=c.getImageData(0,0,1,1).data;
        const sample=[rgba[0],rgba[1],rgba[2]];
        if(this.sampleColors.length>=5)this.sampleColors.shift();
        this.sampleColors.push(sample);
        const likelyPlant=sample[1]>sample[0]*1.2&&sample[1]>sample[2]*1.2;
        $(this.root,'#swa-sample-label').textContent=`${this.sampleColors.length} wall color(s); last RGB(${sample.join(', ')}).`+(likelyPlant?' CAUTION: green sample resembles foliage.':'');
        this.status(likelyPlant?'Green wall color sampled: make sure this is actually masonry, not vegetation.':'Wall color sampled. Run Analyze Image to rescan.');
      }catch(e){this.reportError(e);}finally{this.sampling=false;}
      return;
    }
    if(this.selectingArea){this.drawStart={point:p,mode:'area',current:p};this.canvas.setPointerCapture(event.pointerId);return;}
    const mode=$(this.root,'#swa-tool').value;
    if(mode==='chain'){
      const next=this.snapPoint(p);
      if(this.chainAnchor&&Math.hypot((next.x-this.chainAnchor.x)*this.canvas.width,(next.y-this.chainAnchor.y)*this.canvas.height)>5){
        this.segments.push({x1:this.chainAnchor.x,y1:this.chainAnchor.y,x2:next.x,y2:next.y,type:'wall',source:'manual',confidence:1});
      }
      this.chainAnchor=next;this.selected=this.segments.length-1;this.draw();this.status('Click the next corner. Right-click / Esc / Finish chain to stop.');return;
    }
    if(mode==='select'||mode==='erase'){
      this.selected=this.findNearest(p);
      if(mode==='erase' && this.selected>=0){this.segments.splice(this.selected,1);this.selected=-1;}
      this.draw();return;
    }
    this.drawStart={point:this.snapPoint(p),mode};this.canvas.setPointerCapture(event.pointerId);
  }
  movePointer(event) {
    if(!this.drawStart)return;
    const p=this.position(event);this.drawStart.current=p;this.draw();
    if(this.drawStart.mode==='area')return;
    const ctx=this.context;
    ctx.save();ctx.lineWidth=3;ctx.strokeStyle=COLORS[this.drawStart.mode];
    ctx.beginPath();ctx.moveTo(this.drawStart.point.x*this.canvas.width,this.drawStart.point.y*this.canvas.height);
    ctx.lineTo(p.x*this.canvas.width,p.y*this.canvas.height);ctx.stroke();ctx.restore();
  }
  endPointer(event) {
    if(!this.drawStart)return;
    const raw=this.position(event),s=this.drawStart;this.drawStart=null;
    if(s.mode==='area'){
      const a=s.point,dx=Math.abs(raw.x-a.x)*this.canvas.width,dy=Math.abs(raw.y-a.y)*this.canvas.height;
      if(dx<25||dy<25){this.status('Area selection too small; drag around an entire room/building.');return this.draw();}
      this.scanArea={x1:Math.min(a.x,raw.x),y1:Math.min(a.y,raw.y),x2:Math.max(a.x,raw.x),y2:Math.max(a.y,raw.y)};
      this.selectingArea=false;this.draw();this.status('Building area selected. Run Analyze Selected Area.');return;
    }
    const p=this.snapPoint(raw);
    if(Math.hypot((p.x-s.point.x)*this.canvas.width,(p.y-s.point.y)*this.canvas.height)<5){this.draw();return;}
    this.segments.push({x1:s.point.x,y1:s.point.y,x2:p.x,y2:p.y,type:s.mode,source:'manual',confidence:1});
    this.selected=this.segments.length-1;this.draw();
  }
  backup() {
    const backup={module:ID,version:'0.2.0',sceneId:this.scene.id,sceneName:this.scene.name,
      exportedAt:new Date().toISOString(),walls:Array.from(this.scene.walls,wall=>wall.toObject())};
    this.download(JSON.stringify(backup,null,2),`swa-${this.scene.id}-walls-backup.json`);
    this.status(`Downloaded backup of ${backup.walls.length} existing walls.`, 'success');
  }
  download(text,name) {
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  toDocument(segment) {
    const dim=this.scene.dimensions??this.scene.getDimensions();
    const offsetX=Number(this.scene.background?.offsetX||0),offsetY=Number(this.scene.background?.offsetY||0);
    const sceneX=Number(dim.sceneX||0),sceneY=Number(dim.sceneY||0);
    const sw=Number(dim.sceneWidth||this.scene.width),sh=Number(dim.sceneHeight||this.scene.height);
    const c=[segment.x1*sw+sceneX+offsetX,segment.y1*sh+sceneY+offsetY,
      segment.x2*sw+sceneX+offsetX,segment.y2*sh+sceneY+offsetY].map(n=>Math.round(n));
    if(Math.hypot(c[2]-c[0],c[3]-c[1])<8)return null;
    const base={c,move:1,sight:1,light:1,sound:1,dir:0,door:0,ds:0,
      flags:{[ID]:{generated:true,type:segment.type}}};
    if(segment.type==='door')base.door=1;
    if(segment.type==='window'){base.move=1;base.sight=0;base.light=0;base.sound=0;}
    return base;
  }
  isDuplicate(data,other) {
    const a=data.c,b=other.c;if(!b)return false;
    const distance=(i,j)=>Math.hypot(a[i]-b[j],a[i+1]-b[j+1]);
    if((distance(0,0)<7&&distance(2,2)<7)||(distance(0,2)<7&&distance(2,0)<7))return true;
    const al=Math.hypot(a[2]-a[0],a[3]-a[1]);const bl=Math.hypot(b[2]-b[0],b[3]-b[1]);
    if(al<1||bl<1)return false;
    const cross=Math.abs((a[2]-a[0])*(b[3]-b[1])-(a[3]-a[1])*(b[2]-b[0]))/(al*bl);
    if(cross>0.025)return false;
    const perpendicular=Math.abs((a[2]-a[0])*(b[1]-a[1])-(a[3]-a[1])*(b[0]-a[0]))/al;
    if(perpendicular>7)return false;
    const ux=(a[2]-a[0])/al,uy=(a[3]-a[1])/al;
    const p0=(b[0]-a[0])*ux+(b[1]-a[1])*uy;
    const p1=(b[2]-a[0])*ux+(b[3]-a[1])*uy;
    return Math.max(0,Math.min(al,Math.max(p0,p1))-Math.max(0,Math.min(p0,p1)))>=Math.min(al,bl)*0.8;
  }
  async apply() {
    if(!isGM())throw new Error('GM permission required.');
    if(!canvas?.scene||canvas.scene.id!==this.scene.id)throw new Error('The viewed Scene changed. Reopen Smart Wall Architect.');
    const accepted=this.segments.filter(s=>s.type!=='opening');
    if(!accepted.length)throw new Error('No reviewed walls to apply. Convert proposals or draw some walls first.');
    const existing=Array.from(this.scene.walls,wall=>wall.toObject());
    const documents=[];
    for(const s of accepted) {
      const data=this.toDocument(s);if(!data)continue;
      if($(this.root,'#swa-skip').checked && [...existing,...documents].some(d=>this.isDuplicate(data,d)))continue;
      documents.push(data);
    }
    if(!documents.length)throw new Error('Nothing to add: all candidate segments are duplicates or too short.');
    const unreviewed=this.segments.filter(s=>s.type==='opening').length;
    const confirmText=`Add ${documents.length} reviewed walls to “${this.scene.name}”? Existing walls will NOT be removed. ${unreviewed} opening proposals will be ignored.`;
    if(!window.confirm(confirmText))return;
    this.busy=true;
    try {
      // Persist the last-batch identifier ONLY after successful creation.
      const created=await this.scene.createEmbeddedDocuments('Wall',documents);
      if(!created.length)throw new Error('Foundry did not create any walls.');
      let undoSaved=true;
      try{await this.scene.setFlag(ID,'lastBatch',{created:created.map(w=>w.id),timestamp:Date.now()});}
      catch(e){undoSaved=false;console.warn(`${ID}: walls created, but undo metadata could not be stored`,e);}
      this.status(`Created ${created.length} walls. ${unreviewed} opening proposals skipped.` +
        (undoSaved?' Undo Last Module Batch is available.':' WARNING: undo metadata could not be stored; use your JSON backup.'), undoSaved?'success':'error');
      ui.notifications.info(`Smart Wall Architect: created ${created.length} walls.`);
    } finally {this.busy=false;}
  }
  async undo() {
    if(!isGM())throw new Error('GM permission required.');
    if (!canvas?.scene || canvas.scene.id!==this.scene.id)throw new Error('The viewed Scene changed. Reopen Smart Wall Architect.');
    const last=this.scene.getFlag(ID,'lastBatch');
    const ids=last?.created?.filter(id=>this.scene.walls.get(id))||[];
    if(!ids.length)throw new Error('No last Smart Wall Architect batch to undo for this Scene.');
    if(!window.confirm(`Delete the ${ids.length} walls created by the LAST Smart Wall Architect batch? Other walls will be preserved.`))return;
    this.busy=true;
    try{
      await this.scene.deleteEmbeddedDocuments('Wall',ids);
      await this.scene.unsetFlag(ID,'lastBatch');
      this.status(`Undid ${ids.length} generated walls.`, 'success');
    }finally{this.busy=false;}
  }
}