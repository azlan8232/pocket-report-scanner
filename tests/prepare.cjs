const {createCanvas}=require('@napi-rs/canvas');
const {preparePhoto}=require('../dist/prepare.js');
const assert=require('node:assert/strict');const make=()=>createCanvas(1,1);
const source=createCanvas(200,100);const ctx=source.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,100,100);ctx.fillStyle='blue';ctx.fillRect(100,0,100,100);
const crop=preparePhoto(source,{mode:'original',crop:{left:50,top:0,right:100,bottom:100}},make);assert.equal(crop.width,100);assert.equal(crop.height,100);assert.deepEqual([...crop.getContext('2d').getImageData(50,50,1,1).data],[0,0,255,255]);
const tall=createCanvas(1200,7000);const bounded=preparePhoto(tall,{},make);assert(bounded.width*bounded.height<=12010000,'processing must stay near the 12MP phone memory limit');
console.log('Crop excludes outside pixels; processing memory bound passed.');
