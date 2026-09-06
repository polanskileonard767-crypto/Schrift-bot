const $=s=>document.querySelector(s);
const alphabetRows=[
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  [...'abcdefghijklmnopqrstuvwxyz'],
  [...'0123456789.,!?:;-+=()']
];
const glyphs=new Map();
let generatedSvg='';
const canvas=$('#writingCanvas');
const ctx=canvas.getContext('2d',{willReadFrequently:true});

function bindRange(id,out){const e=$(id),o=$(out);const f=()=>o.value=e.value;e.addEventListener('input',f);f()}
bindRange('#size','#sizeOut');
bindRange('#lineHeight','#lineOut');
bindRange('#variation','#varOut');

function resizeCanvas(){
  const rect=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(rect.width*dpr);
  canvas.height=Math.round(rect.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=4.5;
}
resizeCanvas();
window.addEventListener('resize',()=>{const old=canvas.toDataURL();resizeCanvas();const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,canvas.clientWidth,canvas.clientHeight);img.src=old});

let drawing=false,last=null;
function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;last=point(e);canvas.setPointerCapture?.(e.pointerId);ctx.beginPath();ctx.moveTo(last.x,last.y)});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();last=p});
canvas.addEventListener('pointerup',()=>{drawing=false;last=null});
canvas.addEventListener('pointercancel',()=>{drawing=false;last=null});

function clearCanvas(){ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);glyphs.clear();updateStatus('Noch keine Handschrift gelernt.');}
$('#clearWriting').onclick=clearCanvas;

function updateStatus(text){$('#analysisText').textContent=text}

function grayAt(data,w,x,y){const i=(y*w+x)*4;return (data[i]+data[i+1]+data[i+2])/3}

function findInkBounds(imageData){
  const {data,width:w,height:h}=imageData;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(grayAt(data,w,x,y)<210){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  }
  return maxX<0?null:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
}

function rowInkBounds(imageData,y0,y1){
  const {data,width:w,height:h}=imageData;
  y0=Math.max(0,Math.floor(y0));y1=Math.min(h,Math.ceil(y1));
  const rows=[];
  for(let y=y0;y<y1;y++){
    let ink=0;
    for(let x=0;x<w;x++)if(grayAt(data,w,x,y)<210){ink++;break}
    if(ink)rows.push(y);
  }
  if(!rows.length)return null;
  return {y:rows[0],h:rows[rows.length-1]-rows[0]+1};
}

function connectedComponents(imageData, bounds){
  const {data,width:w,height:h}=imageData;
  const x0=Math.max(0,bounds.x-8),x1=Math.min(w,bounds.x+bounds.w+8);
  const y0=Math.max(0,bounds.y-8),y1=Math.min(h,bounds.y+bounds.h+8);
  const bw=x1-x0,bh=y1-y0;
  const seen=new Uint8Array(bw*bh),out=[];
  const ink=(x,y)=>grayAt(data,w,x0+x,y0+y)<205;
  for(let yy=0;yy<bh;yy++)for(let xx=0;xx<bw;xx++){
    const idx=yy*bw+xx;if(seen[idx]||!ink(xx,yy))continue;
    const q=[idx];seen[idx]=1;let minX=xx,maxX=xx,minY=yy,maxY=yy,n=0;
    for(let qi=0;qi<q.length;qi++){
      const p=q[qi],x=p%bw,y=(p/bw)|0;n++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=bw||ny>=bh)continue;
        const ni=ny*bw+nx;if(!seen[ni]&&ink(nx,ny)){seen[ni]=1;q.push(ni)}
      }
    }
    if(n>=8)out.push({x:x0+minX,y:y0+minY,w:maxX-minX+1,h:maxY-minY+1,n});
  }
  return out.sort((a,b)=>a.x-b.x);
}

function mergeNearby(parts){
  let changed=true,arr=parts.slice();
  while(changed){changed=false;arr.sort((a,b)=>a.x-b.x);
    outer:for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
      const a=arr[i],b=arr[j];
      const gap=b.x-(a.x+a.w);
      const verticalGap=Math.max(b.y-(a.y+a.h),a.y-(b.y+b.h),0);
      const closeX=gap<=Math.max(10,Math.min(a.w,b.w)*0.35);
      const closeY=verticalGap<=Math.max(18,Math.min(a.h,b.h)*1.2);
      if(closeX&&closeY){
        const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),r=Math.max(a.x+a.w,b.x+b.w),bot=Math.max(a.y+a.h,b.y+b.h);
        arr.splice(j,1);arr.splice(i,1,{x,y,w:r-x,h:bot-y,n:a.n+b.n});changed=true;break outer;
      }
    }
  }
  return arr;
}

function cropGlyph(imageData,b){
  const pad=5,c=document.createElement('canvas');
  c.width=Math.max(12,b.w+pad*2);c.height=Math.max(18,b.h+pad*2);
  const g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);
  g.drawImage(canvas,b.x-pad,b.y-pad,b.w+pad*2,b.h+pad*2,0,0,c.width,c.height);
  return {data:c.toDataURL('image/png'),w:c.width,h:c.height,advance:Math.max(12,b.w+pad*2)};
}

function analyzeWriting(){
  const w=canvas.width,h=canvas.height;
  const imageData=ctx.getImageData(0,0,w,h);
  const rowHeight=h/3;
  const all=[];
  alphabetRows.forEach((chars,row)=>{
    const bounds=rowInkBounds(imageData,row*rowHeight,(row+1)*rowHeight);
    if(!bounds){all.push({chars,parts:[]});return}
    let parts=connectedComponents(imageData,bounds);
    parts=mergeNearby(parts).filter(p=>p.w>=3&&p.h>=5);
    all.push({chars,parts});
  });
  glyphs.clear();
  let learned=0,expected=alphabetRows.flat().length,problemRows=[];
  all.forEach(({chars,parts},i)=>{
    if(parts.length!==chars.length)problemRows.push(`${i+1}: ${parts.length}/${chars.length}`);
    const count=Math.min(parts.length,chars.length);
    for(let j=0;j<count;j++){glyphs.set(chars[j],cropGlyph(imageData,parts[j]));learned++;}
  });
  if(!learned){updateStatus('⚠️ Keine Schrift erkannt. Schreibe die drei Reihen zuerst auf die Fläche.');return;}
  if(problemRows.length){updateStatus(`✓ ${learned} Zeichen erkannt. Reihen passen noch nicht exakt (${problemRows.join(', ')}). Schreibe mit etwas mehr Abstand und analysiere erneut.`)}
  else updateStatus(`✓ ${learned} von ${expected} Zeichen gelernt. Deine Handschrift ist bereit.`);
}
$('#analyzeWriting').onclick=analyzeWriting;

function esc(x){return x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

function generate(){
  const text=$('#textInput').value;
  if(!text.trim()){alert('Bitte zuerst einen Text eingeben.');return}
  if(!glyphs.size){alert('Bitte zuerst deine Handschrift analysieren.');return}
  const size=+$('#size').value,line=+$('#lineHeight').value,variation=+$('#variation').value,maxW=1050;
  let x=30,y=size+24,body='',lineNo=0;
  for(const ch of text){
    if(ch==='\n'){x=30;y+=size*line;lineNo++;continue}
    if(ch===' '){x+=size*.42;continue}
    const g=glyphs.get(ch);
    if(!g){x+=size*.52;continue}
    const ratio=g.w/g.h,hh=size*1.05,ww=Math.max(12,hh*ratio*.9);
    const jitter=variation*(Math.random()-.5),scale=1+(variation/100)*(Math.random()-.5);
    body+=`<image href="${g.data}" x="${(x+jitter).toFixed(1)}" y="${(y-hh*.84).toFixed(1)}" width="${(ww*scale).toFixed(1)}" height="${(hh*scale).toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
    x+=ww+variation*(Math.random()-.35);
    if(x>maxW-80){x=30;y+=size*line;lineNo++}
  }
  const height=Math.max(250,y+size*1.25);
  generatedSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${height}" viewBox="0 0 ${maxW} ${height}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
  $('#paper').classList.remove('empty');$('#paper').innerHTML=generatedSvg;
  $('#downloadSvg').disabled=false;$('#downloadPng').disabled=false;$('#copyNotes').disabled=false;
}
$('#generate').onclick=generate;

$('#clearResult').onclick=()=>{$('#paper').classList.add('empty');$('#paper').innerHTML='<span>Noch kein Ergebnis</span>';generatedSvg='';$('#downloadSvg').disabled=true;$('#downloadPng').disabled=true;$('#copyNotes').disabled=true};
$('#downloadSvg').onclick=()=>downloadBlob(new Blob([generatedSvg],{type:'image/svg+xml'}),'schriftbot-text.svg');
$('#downloadPng').onclick=async()=>downloadBlob(await svgToPng(generatedSvg),'schriftbot-text.png');
$('#copyNotes').onclick=async()=>{const b=await svgToPng(generatedSvg);if(navigator.clipboard?.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);else downloadBlob(b,'schriftbot-notizen.png')};
async function svgToPng(svg){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>b?resolve(b):reject(new Error('PNG fehlgeschlagen')),'image/png')};img.onerror=reject;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)})}
