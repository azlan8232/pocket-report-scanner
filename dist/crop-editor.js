(function(root){
'use strict';
const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
function imagePoint(x,y,rect){return {x:clamp((x-rect.left)/rect.width*100),y:clamp((y-rect.top)/rect.height*100)};}
function rectangleFromPoints(a,b){return {left:clamp(Math.min(a.x,b.x)),top:clamp(Math.min(a.y,b.y)),right:clamp(Math.max(a.x,b.x)),bottom:clamp(Math.max(a.y,b.y))};}
class ParagraphCropEditor{
 constructor(onChange){this.onChange=onChange;this.viewport=document.getElementById('cropViewport');this.stage=document.getElementById('cropStage');this.box=document.getElementById('cropBox');this.zoom=1;this.mode='select';this.points=new Map();this.crop={left:0,top:0,right:100,bottom:100};this.disabled=false;
 this.viewport.addEventListener('pointerdown',e=>this.down(e));this.viewport.addEventListener('pointermove',e=>this.move(e));for(const name of ['pointerup','pointercancel','lostpointercapture'])this.viewport.addEventListener(name,e=>this.up(e));
 document.getElementById('zoom').oninput=e=>this.setZoom(+e.target.value/100);
 document.getElementById('zoomIn').onclick=()=>this.setZoom(this.zoom+.25);document.getElementById('zoomOut').onclick=()=>this.setZoom(this.zoom-.25);document.getElementById('zoomFit').onclick=()=>{this.setZoom(1);this.viewport.scrollLeft=0;this.viewport.scrollTop=0;};
 document.getElementById('selectMode').onclick=()=>this.setMode('select');document.getElementById('panMode').onclick=()=>this.setMode('pan');
 new ResizeObserver(()=>{if(this.width)this.layout();}).observe(this.viewport);
 }
 setImage(w,h){this.width=w;this.height=h;this.zoom=1;this.points.clear();this.drag=null;this.pinch=null;this.layout();this.viewport.scrollLeft=0;this.viewport.scrollTop=0;this.setMode('select');}
 setMode(mode){this.mode=mode;for(const [id,value] of [['selectMode','select'],['panMode','pan']])document.getElementById(id).setAttribute('aria-pressed',String(mode===value));this.viewport.dataset.mode=mode;}
 layout(){const base=Math.max(1,this.viewport.clientWidth);this.stage.style.width=base*this.zoom+'px';this.stage.style.height=base*this.zoom*this.height/this.width+'px';document.getElementById('zoom').value=Math.round(this.zoom*100);document.getElementById('zoomValue').textContent=Math.round(this.zoom*100)+'%';}
 setZoom(z,anchor){if(this.disabled||!this.width)return;z=clamp(z,1,5);const rect=this.viewport.getBoundingClientRect();const ax=anchor?anchor.x-rect.left:this.viewport.clientWidth/2,ay=anchor?anchor.y-rect.top:this.viewport.clientHeight/2;const ratio=z/this.zoom;const x=(this.viewport.scrollLeft+ax)*ratio-ax,y=(this.viewport.scrollTop+ay)*ratio-ay;this.zoom=z;this.layout();this.viewport.scrollLeft=x;this.viewport.scrollTop=y;}
 setCrop(crop){this.crop={...crop};Object.assign(this.box.style,{left:crop.left+'%',top:crop.top+'%',width:(crop.right-crop.left)+'%',height:(crop.bottom-crop.top)+'%'});}
 emit(c,commit=false){this.setCrop(c);this.onChange({...c},commit);}
 down(e){if(this.disabled||!this.width||e.button>0)return;e.preventDefault();this.viewport.setPointerCapture(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(this.points.size>=2){if(this.drag?.changed&&this.mode==='select')this.emit(this.drag.crop,true);this.drag=null;this.beginPinch();return;}
 if(this.points.size!==1)return;
 this.drag={start:imagePoint(e.clientX,e.clientY,this.stage.getBoundingClientRect()),crop:{...this.crop},handle:e.target.dataset.corner,client:{x:e.clientX,y:e.clientY},scroll:{x:this.viewport.scrollLeft,y:this.viewport.scrollTop}};
 }
 move(e){if(this.disabled||!this.points.has(e.pointerId))return;e.preventDefault();this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.points.size>=2&&this.pinch){const p=[...this.points.values()].slice(0,2),rect=this.viewport.getBoundingClientRect();const mid={x:(p[0].x+p[1].x)/2-rect.left,y:(p[0].y+p[1].y)/2-rect.top};
 // Anchor the initial image point under the moving finger midpoint. This handles
 // translation and scale together, without accumulating error between fingers.
 this.zoom=clamp(this.pinch.zoom*Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/this.pinch.distance,1,5);this.layout();this.viewport.scrollLeft=this.pinch.imageX*this.zoom-mid.x;this.viewport.scrollTop=this.pinch.imageY*this.zoom-mid.y;return;}
 if(!this.drag)return;const d=this.drag;if(this.mode==='pan'){this.viewport.scrollLeft=d.scroll.x+d.client.x-e.clientX;this.viewport.scrollTop=d.scroll.y+d.client.y-e.clientY;return;}
 const point=imagePoint(e.clientX,e.clientY,this.stage.getBoundingClientRect());let next;if(d.handle){const c=d.crop;const opposite={nw:{x:c.right,y:c.bottom},ne:{x:c.left,y:c.bottom},sw:{x:c.right,y:c.top},se:{x:c.left,y:c.top}}[d.handle];next=rectangleFromPoints(opposite,point);}else next=rectangleFromPoints(d.start,point);
 // A tap keeps the old region; a deliberate drag creates or resizes it.
 if(next.right-next.left>=.25&&next.bottom-next.top>=.25){d.changed=true;this.emit(next);}
 }
 beginPinch(){const p=[...this.points.values()].slice(0,2),rect=this.viewport.getBoundingClientRect();this.pinch={distance:Math.max(1,Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)),zoom:this.zoom,imageX:(this.viewport.scrollLeft+(p[0].x+p[1].x)/2-rect.left)/this.zoom,imageY:(this.viewport.scrollTop+(p[0].y+p[1].y)/2-rect.top)/this.zoom};}
 up(e){if(!this.points.has(e.pointerId))return;this.points.delete(e.pointerId);if(this.drag?.changed)this.onChange({...this.crop},true);this.drag=null;if(this.points.size>=2)this.beginPinch();else this.pinch=null;}
}
root.ParagraphCropEditor=ParagraphCropEditor;
if(typeof module!=='undefined')module.exports={imagePoint,rectangleFromPoints};
})(typeof window==='undefined'?globalThis:window);
