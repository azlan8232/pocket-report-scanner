/* Local photo preparation. No recognition or medical-word substitutions here. */
(function(root){
'use strict';
function preparePhoto(source,{mode='photo',crop={left:0,top:0,right:100,bottom:100}}={},make=()=>document.createElement('canvas')){
 const x=Math.round(source.width*crop.left/100),y=Math.round(source.height*crop.top/100);
 const w=Math.max(1,Math.round(source.width*crop.right/100)-x),h=Math.max(1,Math.round(source.height*crop.bottom/100)-y);
 const input=make();input.width=w;input.height=h;const ctx=input.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.drawImage(source,x,y,w,h,0,0,w,h);
 if(mode==='original')return input;
 // Luminance contrast: suppress grey paper without hard thresholding faint characters.
 const pixels=ctx.getImageData(0,0,w,h),d=pixels.data,hist=new Uint32Array(256);
 for(let i=0;i<d.length;i+=4)hist[Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2])]++;
 const total=w*h;let acc=0,low=0,high=255;
 for(let i=0;i<256;i++){acc+=hist[i];if(acc>=total*.005){low=i;break;}}
 acc=0;for(let i=255;i>=0;i--){acc+=hist[i];if(acc>=total*.005){high=i;break;}}
 if(high-low>30){for(let i=0;i<d.length;i+=4){const v=Math.max(0,Math.min(255,((.299*d[i]+.587*d[i+1]+.114*d[i+2])-low)*255/(high-low)));d[i]=d[i+1]=d[i+2]=v;}ctx.putImageData(pixels,0,0);}
 // Aim for legible glyph sizes, bounded by 12MP to limit phone memory use.
 const scale=Math.min(3,Math.max(1,2400/w),Math.sqrt(12000000/(w*h)));
 const out=make();out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));const oc=out.getContext('2d');oc.fillStyle='white';oc.fillRect(0,0,out.width,out.height);oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';oc.drawImage(input,0,0,out.width,out.height);return out;
}
root.preparePhoto=preparePhoto;
if(typeof module!=='undefined')module.exports={preparePhoto};
})(typeof window==='undefined'?globalThis:window);
