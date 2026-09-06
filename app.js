const $=s=>document.querySelector(s);
const sampleText=$('#sampleText').textContent.trim();
let sampleImage=null,generatedSvg=null,glyphs=new Map();

function bindRange(id,out){const e=$(id),o=$(out);const f=()=>o.value=e.value;e.addEventListener('input',f);f()}
bindRange('#size','#sizeOut');bindRange('#lineHeight','#lineOut');bindRange('#variation','#varOut');

$('#copySample').onclick=async()=>{const text=sampleText;try{await navigator.clipboard.writeText(text)}catch{const a=document.createElement('textarea');a.value=text;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}$('#copySample').textContent='✓ Kopiert';setTimeout(()=>$('#copySample').textContent='Text kopieren',1600)};

// Robust file upload for Android, iPad/iPhone and desktop browsers.
const sampleInput=$('#sampleInput');
sampleInput.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadSample(f)});
const dz=$('#dropZone');
['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor='#6366f1'}));
['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor=''}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f?.type?.startsWith('image/'))loadSample(f)});

function loadSample(file){
  if(!file||file.size===0){showUploadError('Die Datei ist leer oder konnte nicht gelesen werden.');return}
  $('#previewWrap').classList.remove('hidden');
  $('#sampleStatus').textContent='Bild wird geladen…';
  $('#analysisText').textContent='Bild wird verarbeitet…';
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      sampleImage=img;
      const c=$('#sampleCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});
      const scale=Math.min(1,1100/img.width);
      c.width=Math.max(1,Math.round(img.width*scale));
      c.height=Math.max(1,Math.round(img.height*scale));
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0,c.width,c.height);
      $('#sampleStatus').textContent=`✓ ${img.width}×${img.height} · analysiere…`;
      analyzeSample();
    };
    img.onerror=()=>showUploadError('Dieses Bildformat kann der Browser nicht öffnen. Bitte als JPG oder PNG auswählen.');
    img.src=reader.result;
  };
  reader.onerror=()=>showUploadError('Das Bild konnte nicht gelesen werden. Bitte erneut auswählen.');
  reader.readAsDataURL(file);
}

function showUploadError(message){
  $('#previewWrap').classList.remove('hidden');
  $('#sampleStatus').textContent='⚠️ Upload fehlgeschlagen';
  $('#analysisText').textContent=message;
  sampleImage=null;
  glyphs=new Map();
}

function analyzeSample(){
  if(!sampleImage)return;
  glyphs=new Map();
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/sampleImage.width);canvas.width=Math.round(sampleImage.width*scale);canvas.height=Math.round(sampleImage.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(sampleImage,0,0,canvas.width,canvas.height);
  const {data,width,height}=ctx,ink=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];ink[y*width+x]=lum<205?1:0}
  const rows=[];let active=false,start=0;
  for(let y=0;y<height;y++){let n=0;for(let x=0;x<width;x++)n+=ink[y*width+x];const hit=n>Math.max(2,width*.006);if(hit&&!active){start=y;active=true}if((!hit||y===height-1)&&active){const end=y-(!hit?1:0);if(end-start>=5)rows.push([start,end]);active=false}}
  const merged=[];for(const r of rows){const last=merged.at(-1);if(last&&r[0]-last[1]<Math.max(10,(r[1]-r[0])*.55))last[1]=r[1];else merged.push(r)}
  const expectedLines=sampleText.split('\n');
  const bands=pickBands(merged,expectedLines.length);
  let total=0;
  bands.forEach((band,li)=>{const expected=[...(expectedLines[li]||'')].filter(c=>c!==' ');if(!expected.length)return;const xs=[];for(let x=0;x<width;x++){let n=0;for(let y=band[0];y<=band[1];y++)n+=ink[y*width+x];xs.push(n)}const seg=splitColumns(xs,band[0],band[1]);const usable=seg.length>=expected.length?compressToCount(seg,expected.length):adaptiveSlots(xs,expected.length);for(let i=0;i<Math.min(expected.length,usable.length);i++){const crop=makeCrop(canvas,usable[i][0],band[0],usable[i][1],band[1]);if(!crop)continue;const ch=expected[i];if(!glyphs.has(ch))glyphs.set(ch,[]);glyphs.get(ch).push(crop);total++}});
  const unique=glyphs.size;$('#sampleStatus').textContent=`✓ ${unique} Zeichen erkannt`;
  $('#analysisText').textContent=total?`Analyse fertig: ${unique} Zeichen aus deiner Probe. Sie werden beim Erzeugen verwendet.`:'Analyse konnte die Probe nicht sauber erkennen. Bitte gerade fotografieren und möglichst schwarzen Stift auf weißem Hintergrund verwenden.';
}
function pickBands(rows,count){if(rows.length===count)return rows;const out=[];if(rows.length>count){for(let i=0;i<count;i++){const a=Math.floor(i*rows.length/count),b=Math.max(a,Math.floor((i+1)*rows.length/count)-1);out.push([rows[a][0],rows[b][1]])}}else return rows;return out}
function splitColumns(xs,y0,y1){const threshold=Math.max(1,Math.round((y1-y0)*.025)),raw=[];let on=false,s=0;for(let x=0;x<xs.length;x++){if(xs[x]>threshold&&!on){s=x;on=true}if((xs[x]<=threshold||x===xs.length-1)&&on){const e=x-(xs[x]<=threshold?1:0);if(e-s>=2)raw.push([s,e]);on=false}}if(!raw.length)return[];const widths=raw.map(r=>r[1]-r[0]+1).sort((a,b)=>a-b),med=widths[Math.floor(widths.length/2)]||10,out=[];for(const r of raw){const last=out.at(-1);if(last&&r[0]-last[1]<Math.max(4,med*.45))last[1]=r[1];else out.push(r)}return out}
function compressToCount(seg,count){if(seg.length===count)return seg;const out=[];for(let i=0;i<count;i++){const a=Math.floor(i*seg.length/count),b=Math.max(a,Math.floor((i+1)*seg.length/count)-1);out.push([seg[a][0],seg[b][1]])}return out}
function adaptiveSlots(xs,count){const first=xs.findIndex(v=>v>0),last=xs.length-1-xs.slice().reverse().findIndex(v=>v>0);if(first<0||last<first)return[];const out=[];for(let i=0;i<count;i++)out.push([Math.round(first+(last-first)*i/count),Math.round(first+(last-first)*(i+1)/count)-1]);return out}
function makeCrop(src,x0,y0,x1,y1){const pad=5,w=Math.max(2,x1-x0+1),h=Math.max(2,y1-y0+1),c=document.createElement('canvas');c.width=w+pad*2;c.height=h+pad*2;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(src,x0,y0,w,h,pad,pad,w,h);return c.toDataURL('image/png')}

$('#downloadTemplate').onclick=()=>{const svg=makeTemplate();downloadBlob(new Blob([svg],{type:'image/svg+xml'}),'schriftbot-vorlage.svg')};
function makeTemplate(){const lines=sampleText.split('\n');const w=1400,h=lines.length*110+100;let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial;fill:#555}.guide{stroke:#dfe3ea}</style>`;lines.forEach((line,i)=>{const y=70+i*110;s+=`<text x="35" y="${y-35}" font-size="13">Zeile ${i+1}: genau diese Zeile abschreiben</text><line class="guide" x1="35" y1="${y+12}" x2="${w-35}" y2="${y+12}"/><text x="35" y="${y}" font-size="17">${esc(line)}</text>`});return s+'</svg>'}

$('#generate').onclick=()=>{const text=$('#textInput').value.trim();if(!text){alert('Bitte zuerst Text eingeben.');return}if(!sampleImage){alert('Bitte zuerst deine Handschriftprobe hochladen.');return}generatedSvg=renderText(text);const paper=$('#paper');paper.classList.remove('empty');paper.innerHTML='';paper.appendChild(generatedSvg);$('#downloadSvg').disabled=false;$('#downloadPng').disabled=false;document.querySelectorAll('.step')[0].classList.remove('active');document.querySelectorAll('.step')[1].classList.add('active');document.querySelectorAll('.step')[2].classList.add('active');wireDelete(generatedSvg)};

function renderText(text){const size=+$('#size').value,lh=+$('#lineHeight').value,variation=+$('#variation').value;const lines=text.replace(/\r/g,'').split('\n');const maxChars=Math.max(35,...lines.map(x=>x.length));const width=Math.min(1600,Math.max(760,maxChars*size*.58+80));const height=Math.max(420,lines.length*size*lh+70);const svg=el('svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);let y=size+18;
lines.forEach(line=>{let x=28;for(const ch of [...line]){if(ch===' '){x+=size*.36;continue}const g=el('g');g.classList.add('glyph');g.dataset.char=ch;const rot=(Math.random()-.5)*variation,scale=1+(Math.random()-.5)*variation/100;g.setAttribute('transform',`translate(${x} ${y-size}) rotate(${rot}) scale(${scale})`);const list=glyphs.get(ch);if(list?.length){const img=el('image');img.setAttribute('href',list[Math.floor(Math.random()*list.length)]);img.setAttribute('x',0);img.setAttribute('y',0);img.setAttribute('width',size*.72);img.setAttribute('height',size);img.setAttribute('preserveAspectRatio','xMidYMid meet');g.appendChild(img)}else{const t=el('text');t.textContent=ch;t.setAttribute('font-size',size);t.setAttribute('dominant-baseline','alphabetic');t.setAttribute('fill','#111');g.appendChild(t)}svg.appendChild(g);x+=measure(ch,size)+size*.03}y+=size*lh});return svg}
function measure(ch,size){if('ilI.,!|'.includes(ch))return size*.28;if('mwMW@'.includes(ch))return size*.82;return size*.55}
function el(name){return document.createElementNS('http://www.w3.org/2000/svg',name)}
function esc(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function wireDelete(svg){svg.addEventListener('click',e=>{const g=e.target.closest('.glyph');if(g){document.querySelectorAll('.glyph.selected').forEach(x=>x.classList.remove('selected'));g.classList.add('selected')}})}
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&document.querySelector('.glyph.selected')){e.preventDefault();document.querySelector('.glyph.selected').remove()}});
$('#clearResult').onclick=()=>{$('#paper').className='paper empty';$('#paper').innerHTML='<span>Noch kein Ergebnis</span>';generatedSvg=null;$('#downloadSvg').disabled=true;$('#downloadPng').disabled=true};
$('#downloadSvg').onclick=()=>{if(generatedSvg){const clone=generatedSvg.cloneNode(true);clone.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),'schriftbot-ergebnis.svg')}};
$('#downloadPng').onclick=()=>{if(!generatedSvg)return;const data=new XMLSerializer().serializeToString(generatedSvg);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=+generatedSvg.getAttribute('width');c.height=+generatedSvg.getAttribute('height');c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>downloadBlob(b,'schriftbot-ergebnis.png'),'image/png')};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data)};
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}