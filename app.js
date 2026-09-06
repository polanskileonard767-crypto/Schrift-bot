const $=s=>document.querySelector(s);
const sampleText=$('#sampleText').textContent.trim();
let sampleImage=null,generatedSvg=null,glyphs=new Map();

function bindRange(id,out){const e=$(id),o=$(out);const f=()=>o.value=e.value;e.addEventListener('input',f);f()}
bindRange('#size','#sizeOut');bindRange('#lineHeight','#lineOut');bindRange('#variation','#varOut');

$('#copySample').onclick=async()=>{const text=sampleText;try{await navigator.clipboard.writeText(text)}catch{const a=document.createElement('textarea');a.value=text;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}$('#copySample').textContent='✓ Kopiert';setTimeout(()=>$('#copySample').textContent='Text kopieren',1600)};

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
  $('#analysisText').textContent='Handschrift wird analysiert…';
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      sampleImage=img;
      const c=$('#sampleCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});
      const scale=Math.min(1,1100/img.width);
      c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
      ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      $('#sampleStatus').textContent=`✓ ${img.width}×${img.height} · Handschrift wird gelernt…`;
      analyzeSample();
    };
    img.onerror=()=>showUploadError('Dieses Bildformat kann der Browser nicht öffnen. Bitte als JPG oder PNG auswählen.');
    img.src=reader.result;
  };
  reader.onerror=()=>showUploadError('Das Bild konnte nicht gelesen werden. Bitte erneut auswählen.');
  reader.readAsDataURL(file);
}

function showUploadError(message){$('#previewWrap').classList.remove('hidden');$('#sampleStatus').textContent='⚠️ Upload fehlgeschlagen';$('#analysisText').textContent=message;sampleImage=null;glyphs=new Map()}

function analyzeSample(){
  if(!sampleImage)return;
  glyphs=new Map();
  const src=document.createElement('canvas');
  const scale=Math.min(1,1800/sampleImage.width);
  src.width=Math.max(1,Math.round(sampleImage.width*scale));src.height=Math.max(1,Math.round(sampleImage.height*scale));
  const ctx=src.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,src.width,src.height);ctx.drawImage(sampleImage,0,0,src.width,src.height);
  const {data,width,height}=ctx.getImageData(0,0,src.width,src.height);
  const ink=new Uint8Array(width*height),rowSum=new Uint32Array(height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];const v=lum<220?1:0;ink[y*width+x]=v;rowSum[y]+=v}
  // Find the six handwritten lines using horizontal ink density. Small gaps inside letters are ignored.
  const lineHits=[];const rowThreshold=Math.max(3,Math.floor(width*.002));let on=false,start=0;
  for(let y=0;y<height;y++){
    const hit=rowSum[y]>rowThreshold;
    if(hit&&!on){start=y;on=true}
    if((!hit||y===height-1)&&on){const end=y-(hit?0:1);if(end-start>=3)lineHits.push([start,end]);on=false}
  }
  const lines=mergeLineBands(lineHits);
  const expectedLines=sampleText.split('\n');
  const bands=chooseLineBands(lines,expectedLines.length,height);
  let total=0;
  for(let li=0;li<expectedLines.length;li++){
    const text=[...expectedLines[li]];
    const band=bands[li];
    if(!band)continue;
    const usable=text.filter(ch=>ch!==' ');
    if(!usable.length)continue;
    const segments=segmentKnownLine(ink,width,height,band,text);
    for(let i=0;i<usable.length;i++){
      const ch=usable[i],seg=segments[i];
      if(!seg)continue;
      const crop=makeInkCrop(src,seg[0],band[0],seg[1],band[1]);
      if(!crop)continue;
      if(!glyphs.has(ch))glyphs.set(ch,[]);
      glyphs.get(ch).push(crop);total++;
    }
  }
  // Add smart aliases for umlauts and punctuation so generated text stays handwritten whenever possible.
  addAliases();
  const unique=glyphs.size;
  $('#sampleStatus').textContent=`✓ ${unique} Handschrift-Zeichen gelernt`;
  $('#analysisText').textContent=total?`Handschrift gelernt: ${unique} Zeichen. Beim Erzeugen werden echte Ausschnitte deiner Probe verwendet.`:'Die Handschrift konnte nicht erkannt werden. Bitte ein scharfes Foto mit weißem Hintergrund und dunkler Schrift hochladen.';
}

function mergeLineBands(lines){
  if(!lines.length)return[];
  const out=[lines[0].slice()];
  for(let i=1;i<lines.length;i++){const prev=out[out.length-1],cur=lines[i];const gap=cur[0]-prev[1];const h=prev[1]-prev[0]+1;if(gap<Math.max(12,h*.65))prev[1]=cur[1];else out.push(cur.slice())}
  return out;
}
function chooseLineBands(lines,count,height){
  if(lines.length===count)return lines;
  if(lines.length>count){
    const out=[];for(let i=0;i<count;i++){const a=Math.floor(i*lines.length/count),b=Math.max(a,Math.floor((i+1)*lines.length/count)-1);out.push([lines[a][0],lines[b][1]])}return out;
  }
  // If a line was not detected, divide the image into equal horizontal bands.
  const margin=Math.round(height*.03),usable=Math.max(1,height-margin*2),out=[];
  for(let i=0;i<count;i++){const a=margin+Math.round(usable*i/count),b=margin+Math.round(usable*(i+1)/count)-1;out.push([a,b])}return out;
}

function segmentKnownLine(ink,width,height,band,text){
  const chars=text.filter(ch=>ch!==' ');if(!chars.length)return[];
  const y0=Math.max(0,band[0]),y1=Math.min(height-1,band[1]);
  const xs=new Uint32Array(width);
  for(let x=0;x<width;x++)for(let y=y0;y<=y1;y++)xs[x]+=ink[y*width+x];
  let left=0;while(left<width&&xs[left]===0)left++;
  let right=width-1;while(right>left&&xs[right]===0)right--;
  if(right<=left)return[];
  // Find low-ink valleys. These are better character boundaries than raw connected components because letters like i/j split vertically.
  const valleys=[];let inValley=false,vs=0;
  const valleyThreshold=Math.max(1,Math.floor((y1-y0+1)*.025));
  for(let x=left;x<=right;x++){
    const low=xs[x]<=valleyThreshold;
    if(low&&!inValley){vs=x;inValley=true}
    if((!low||x===right)&&inValley){const ve=x-(low?0:1);if(ve-vs>=2)valleys.push([vs,ve]);inValley=false}
  }
  const gaps=[];for(const v of valleys){if(v[0]>left+2&&v[1]<right-2)gaps.push(v)}
  // Start with valley-based boundaries, then fall back to proportional slots if the photo is too tightly written.
  const boundaries=[];
  for(const g of gaps){const center=Math.round((g[0]+g[1])/2);if(!boundaries.length||center-boundaries[boundaries.length-1]>3)boundaries.push(center)}
  const wanted=chars.length-1;
  let cuts=[];
  if(boundaries.length>=wanted){
    // Select the valleys closest to evenly distributed expected character positions.
    for(let i=1;i<=wanted;i++){const target=left+(right-left)*i/chars.length;let best=boundaries[0],bd=Math.abs(best-target);for(const b of boundaries){const d=Math.abs(b-target);if(d<bd){bd=d;best=b}}cuts.push(best)}
    cuts=[...new Set(cuts)].sort((a,b)=>a-b);
  }else{
    cuts=[];for(let i=1;i<chars.length;i++)cuts.push(Math.round(left+(right-left)*i/chars.length));
  }
  const seg=[];let s=left;
  for(const c of cuts){seg.push([s,c-1]);s=c+1}
  seg.push([s,right]);
  // Ensure exactly one segment per non-space character.
  if(seg.length!==chars.length){seg.length=0;for(let i=0;i<chars.length;i++)seg.push([Math.round(left+(right-left)*i/chars.length),Math.round(left+(right-left)*(i+1)/chars.length)-1])}
  return seg;
}

function makeInkCrop(src,x0,y0,x1,y1){
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(src.width-1,Math.ceil(x1));y1=Math.min(src.height-1,Math.ceil(y1));
  const w=Math.max(2,x1-x0+1),h=Math.max(2,y1-y0+1),pad=4,c=document.createElement('canvas');c.width=w+pad*2;c.height=h+pad*2;
  const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(src,x0,y0,w,h,pad,pad,w,h);
  return c.toDataURL('image/png');
}
function addGlyphAlias(from,to){const a=glyphs.get(from);if(a?.length&&!glyphs.has(to))glyphs.set(to,a)}
function addAliases(){addGlyphAlias('a','ä');addGlyphAlias('o','ö');addGlyphAlias('u','ü');addGlyphAlias('A','Ä');addGlyphAlias('O','Ö');addGlyphAlias('U','Ü');addGlyphAlias('s','ß');addGlyphAlias('.','·');addGlyphAlias(',','‚')}

$('#downloadTemplate').onclick=()=>{const svg=makeTemplate();downloadBlob(new Blob([svg],{type:'image/svg+xml'}),'schriftbot-vorlage.svg')};
function makeTemplate(){const lines=sampleText.split('\n');const w=1400,h=lines.length*110+100;let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial;fill:#555}.guide{stroke:#dfe3ea}</style>`;lines.forEach((line,i)=>{const y=70+i*110;s+=`<text x="35" y="${y-35}" font-size="13">Zeile ${i+1}: genau diese Zeile abschreiben</text><line class="guide" x1="35" y1="${y+12}" x2="${w-35}" y2="${y+12}"/><text x="35" y="${y}" font-size="17">${esc(line)}</text>`});return s+'</svg>'}

$('#generate').onclick=()=>{const text=$('#textInput').value.trim();if(!text){alert('Bitte zuerst Text eingeben.');return}if(!sampleImage){alert('Bitte zuerst deine Handschriftprobe hochladen.');return}generatedSvg=renderText(text);const paper=$('#paper');paper.classList.remove('empty');paper.innerHTML='';paper.appendChild(generatedSvg);$('#downloadSvg').disabled=false;$('#downloadPng').disabled=false;document.querySelectorAll('.step')[0].classList.remove('active');document.querySelectorAll('.step')[1].classList.add('active');document.querySelectorAll('.step')[2].classList.add('active');wireDelete(generatedSvg)};

function findGlyph(ch){if(glyphs.has(ch))return glyphs.get(ch);const lower=ch.toLowerCase(),upper=ch.toUpperCase();if(glyphs.has(lower))return glyphs.get(lower);if(glyphs.has(upper))return glyphs.get(upper);return null}
function renderText(text){const size=+$('#size').value,lh=+$('#lineHeight').value,variation=+$('#variation').value;const lines=text.replace(/\r/g,'').split('\n');const maxChars=Math.max(35,...lines.map(x=>x.length));const width=Math.min(1600,Math.max(760,maxChars*size*.58+80));const height=Math.max(420,lines.length*size*lh+70);const svg=el('svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);let y=size+18;
lines.forEach(line=>{let x=28;for(const ch of [...line]){if(ch===' '){x+=size*.36;continue}const g=el('g');g.classList.add('glyph');g.dataset.char=ch;const rot=(Math.random()-.5)*variation,scale=1+(Math.random()-.5)*variation/100;g.setAttribute('transform',`translate(${x} ${y-size}) rotate(${rot}) scale(${scale})`);const list=findGlyph(ch);if(list?.length){const img=el('image');img.setAttribute('href',list[Math.floor(Math.random()*list.length)]);img.setAttribute('x',0);img.setAttribute('y',0);img.setAttribute('width',size*.72);img.setAttribute('height',size);img.setAttribute('preserveAspectRatio','xMidYMid meet');g.appendChild(img)}else{const t=el('text');t.textContent=ch;t.setAttribute('font-size',size);t.setAttribute('dominant-baseline','alphabetic');t.setAttribute('fill','#111');g.appendChild(t)}svg.appendChild(g);x+=measure(ch,size)+size*.03}y+=size*lh});return svg}
function measure(ch,size){if('ilI.,!|'.includes(ch))return size*.28;if('mwMW@'.includes(ch))return size*.82;return size*.55}
function el(name){return document.createElementNS('http://www.w3.org/2000/svg',name)}
function esc(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function wireDelete(svg){svg.addEventListener('click',e=>{const g=e.target.closest('.glyph');if(g){document.querySelectorAll('.glyph.selected').forEach(x=>x.classList.remove('selected'));g.classList.add('selected')}})}
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&document.querySelector('.glyph.selected')){e.preventDefault();document.querySelector('.glyph.selected').remove()}});
$('#clearResult').onclick=()=>{$('#paper').className='paper empty';$('#paper').innerHTML='<span>Noch kein Ergebnis</span>';generatedSvg=null;$('#downloadSvg').disabled=true;$('#downloadPng').disabled=true};
$('#downloadSvg').onclick=()=>{if(generatedSvg){const clone=generatedSvg.cloneNode(true);clone.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),'schriftbot-ergebnis.svg')}};
$('#downloadPng').onclick=()=>{if(!generatedSvg)return;const data=new XMLSerializer().serializeToString(generatedSvg);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=+generatedSvg.getAttribute('width');c.height=+generatedSvg.getAttribute('height');c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>downloadBlob(b,'schriftbot-ergebnis.png'),'image/png')};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data)};
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}