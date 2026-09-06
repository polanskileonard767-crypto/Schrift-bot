const $=s=>document.querySelector(s);
const sampleText=$('#sampleText').textContent.trim();
let sampleImage=null,generatedSvg=null,glyphs=new Map();

function bindRange(id,out){const e=$(id),o=$(out);const f=()=>o.value=e.value;e.addEventListener('input',f);f()}
bindRange('#size','#sizeOut');bindRange('#lineHeight','#lineOut');bindRange('#variation','#varOut');

$('#copySample').onclick=async()=>{try{await navigator.clipboard.writeText(sampleText)}catch{const a=document.createElement('textarea');a.value=sampleText;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}$('#copySample').textContent='✓ Kopiert';setTimeout(()=>$('#copySample').textContent='Text kopieren',1600)};

const sampleInput=$('#sampleInput');
sampleInput.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadSample(f)});
const dz=$('#dropZone');
['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor='#6366f1'}));
['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor=''}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f?.type?.startsWith('image/'))loadSample(f)});

function loadSample(file){
  if(!file||!file.size)return uploadError('Die Datei ist leer oder konnte nicht gelesen werden.');
  $('#previewWrap').classList.remove('hidden');$('#sampleStatus').textContent='Bild wird geladen…';$('#analysisText').textContent='Handschrift wird analysiert…';
  const reader=new FileReader();
  reader.onload=()=>{const img=new Image();img.onload=()=>{sampleImage=img;const c=$('#sampleCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});const scale=Math.min(1,1100/img.width);c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);$('#sampleStatus').textContent=`✓ ${img.width}×${img.height} · Handschrift wird gelernt…`;setTimeout(analyzeSample,20)};img.onerror=()=>uploadError('Dieses Bildformat kann der Browser nicht öffnen. Bitte JPG oder PNG verwenden.');img.src=reader.result};
  reader.onerror=()=>uploadError('Das Bild konnte nicht gelesen werden. Bitte erneut auswählen.');reader.readAsDataURL(file);
}
function uploadError(msg){$('#previewWrap').classList.remove('hidden');$('#sampleStatus').textContent='⚠️ Bild konnte nicht verarbeitet werden';$('#analysisText').textContent=msg;sampleImage=null;glyphs.clear()}

// The sample text is known, so we use its word/character order to cut the user's actual handwriting.
// This is much more reliable than treating every connected ink blob as a letter.
function analyzeSample(){
  if(!sampleImage)return;
  glyphs=new Map();
  const canvas=document.createElement('canvas');const scale=Math.min(1,1800/sampleImage.width);canvas.width=Math.max(1,Math.round(sampleImage.width*scale));canvas.height=Math.max(1,Math.round(sampleImage.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(sampleImage,0,0,canvas.width,canvas.height);
  const {data,width,height}=ctx,ink=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];ink[y*width+x]=lum<215?1:0}

  const rows=findRows(ink,width,height);
  const expectedLines=sampleText.split('\n');
  const bands=matchRows(rows,expectedLines.length);
  let learned=0;
  bands.forEach((band,lineIndex)=>{
    const expected=expectedLines[lineIndex]||'';
    if(!expected)return;
    const words=[...expected.matchAll(/\S+/g)];
    const wordBoxes=findWordBoxes(ink,width,band[0],band[1]);
    if(words.length&&wordBoxes.length){
      const n=Math.min(words.length,wordBoxes.length);
      for(let wi=0;wi<n;wi++){
        const word=words[wi][0],box=wordBoxes[wi];
        learnWord(canvas,word,box[0],box[1],band[0],band[1]);
      }
    }else{
      learnLine(canvas,expected,band[0],band[1],ink,width);
    }
  });
  for(const list of glyphs.values())learned+=list.length;
  const unique=glyphs.size;
  $('#sampleStatus').textContent=`✓ ${unique} Zeichen gelernt`;
  $('#analysisText').textContent=learned?`Deine Handschrift wurde übernommen: ${unique} verschiedene Zeichen. Beim Erzeugen werden echte Ausschnitte deiner Schrift verwendet.`:'Ich konnte die Schriftprobe nicht sauber erkennen. Bitte das Foto gerade, hell und vollständig aufnehmen.';
}

function findRows(ink,w,h){const rows=[];let active=false,s=0;for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)n+=ink[y*w+x];const hit=n>Math.max(3,w*.003);if(hit&&!active){s=y;active=true}if(active&&(!hit||y===h-1)){const e=y-(hit?0:1);if(e-s>=4)rows.push([s,e]);active=false}}const out=[];for(const r of rows){const last=out.at(-1);if(last&&r[0]-last[1]<Math.max(12,(r[1]-r[0])*.7))last[1]=r[1];else out.push(r)}return out}
function matchRows(rows,count){if(rows.length===count)return rows;if(rows.length>count){return Array.from({length:count},(_,i)=>{const a=Math.floor(i*rows.length/count),b=Math.max(a,Math.floor((i+1)*rows.length/count)-1);return[rows[a][0],rows[b][1]]})}return rows}

function findWordBoxes(ink,w,y0,y1){
  const xs=[];for(let x=0;x<w;x++){let n=0;for(let y=y0;y<=y1;y++)n+=ink[y*w+x];xs.push(n)}
  const active=[];let start=-1;const gap=Math.max(3,Math.round((y1-y0)*.12));let empty=0;
  for(let x=0;x<w;x++){
    if(xs[x]>0){if(start<0)start=x;empty=0}else if(start>=0){empty++;if(empty>=gap){active.push([start,x-empty]);start=-1;empty=0}}
  }
  if(start>=0)active.push([start,w-1]);
  if(active.length<2)return active;
  const widths=active.map(a=>a[1]-a[0]+1).sort((a,b)=>a-b);const med=widths[Math.floor(widths.length/2)]||20;
  const merged=[];for(const b of active){const last=merged.at(-1);if(last&&b[0]-last[1]<Math.max(6,med*.18))last[1]=b[1];else merged.push(b)}
  return merged.filter(b=>b[1]-b[0]>2);
}

function charWeight(ch){if('ilI.,:;!|'.includes(ch))return .38;if('mwMW@'.includes(ch))return 1.25;if('ftrj'.includes(ch))return .72;return 1}
function learnWord(canvas,word,x0,x1,y0,y1){
  const chars=[...word];const weights=chars.map(charWeight),sum=weights.reduce((a,b)=>a+b,0);let x=x0;
  chars.forEach((ch,i)=>{const nx=i===chars.length-1?x1:Math.round(x+(x1-x0+1)*weights[i]/sum);const crop=makeCrop(canvas,x,y0,nx,y1);if(crop){if(!glyphs.has(ch))glyphs.set(ch,[]);glyphs.get(ch).push(crop)}x=nx+1});
}
function learnLine(canvas,line,y0,y1,ink,w){const chars=[...line];const nonSpace=chars.filter(c=>c!==' ');if(!nonSpace.length)return;let min=w,max=-1;for(let x=0;x<w;x++){for(let y=y0;y<=y1;y++)if(ink[y*w+x]){min=Math.min(min,x);max=Math.max(max,x);break}}if(max<min)return;const weights=nonSpace.map(charWeight),sum=weights.reduce((a,b)=>a+b,0);let x=min,k=0;for(const ch of chars){if(ch===' '){x+=(max-min)*.035;continue}const nx=k===nonSpace.length-1?max:Math.round(x+(max-min+1)*weights[k]/sum);const crop=makeCrop(canvas,x,y0,nx,y1);if(crop){if(!glyphs.has(ch))glyphs.set(ch,[]);glyphs.get(ch).push(crop)}x=nx+1;k++}}

function makeCrop(src,x0,y0,x1,y1){const pad=6,w=Math.max(3,x1-x0+1),h=Math.max(3,y1-y0+1),c=document.createElement('canvas');c.width=w+pad*2;c.height=h+pad*2;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(src,x0,y0,w,h,pad,pad,w,h);const p=ctx.getImageData(0,0,c.width,c.height),d=p.data;for(let i=0;i<d.length;i+=4){const lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(lum>235)d[i+3]=0;else d[i+3]=Math.max(0,Math.min(255,Math.round((235-lum)*1.8)))}ctx.putImageData(p,0,0);return c.toDataURL('image/png')}

$('#downloadTemplate').onclick=()=>{downloadBlob(new Blob([makeTemplate()],{type:'image/svg+xml'}),'schriftbot-vorlage.svg')};
function makeTemplate(){const lines=sampleText.split('\n'),w=1500,h=lines.length*110+100;let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial;fill:#555}.guide{stroke:#dfe3ea}</style>`;lines.forEach((line,i)=>{const y=70+i*110;s+=`<text x="35" y="${y-35}" font-size="13">Zeile ${i+1}: Schreibe genau diese Zeile auf die Linie</text><line class="guide" x1="35" y1="${y+12}" x2="${w-35}" y2="${y+12}"/><text x="35" y="${y}" font-size="17">${esc(line)}</text>`});return s+'</svg>'}

$('#generate').onclick=()=>{const text=$('#textInput').value.trim();if(!text)return alert('Bitte zuerst Text eingeben.');if(!sampleImage)return alert('Bitte zuerst deine Handschriftprobe hochladen.');if(!glyphs.size)return alert('Die Handschriftprobe wurde noch nicht erkannt. Bitte erneut hochladen.');generatedSvg=renderText(text);const paper=$('#paper');paper.classList.remove('empty');paper.innerHTML='';paper.appendChild(generatedSvg);$('#downloadSvg').disabled=false;$('#downloadPng').disabled=false;document.querySelectorAll('.step')[0].classList.remove('active');document.querySelectorAll('.step')[1].classList.add('active');document.querySelectorAll('.step')[2].classList.add('active');wireDelete(generatedSvg)};

function renderText(text){const size=+$('#size').value,lh=+$('#lineHeight').value,variation=+$('#variation').value,lines=text.replace(/\r/g,'').split('\n');const maxChars=Math.max(35,...lines.map(x=>x.length)),width=Math.min(1600,Math.max(760,maxChars*size*.58+80)),height=Math.max(420,lines.length*size*lh+70);const svg=el('svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);let y=size+18;
  lines.forEach(line=>{let x=28;for(const ch of [...line]){if(ch===' '){x+=size*.36;continue}const g=el('g');g.classList.add('glyph');g.dataset.char=ch;const rot=(Math.random()-.5)*variation,sc=1+(Math.random()-.5)*variation/100;g.setAttribute('transform',`translate(${x} ${y-size}) rotate(${rot}) scale(${sc})`);const list=glyphs.get(ch);if(list?.length){const img=el('image');img.setAttribute('href',list[Math.floor(Math.random()*list.length)]);img.setAttribute('x',0);img.setAttribute('y',0);img.setAttribute('width',size*.78);img.setAttribute('height',size);img.setAttribute('preserveAspectRatio','xMidYMid meet');g.appendChild(img)}else{const t=el('text');t.textContent=ch;t.setAttribute('font-size',size);t.setAttribute('fill','#111');t.setAttribute('dominant-baseline','alphabetic');g.appendChild(t)}svg.appendChild(g);x+=measure(ch,size)+size*.03}y+=size*lh});return svg}
function measure(ch,size){if('ilI.,:;!|'.includes(ch))return size*.28;if('mwMW@'.includes(ch))return size*.82;return size*.55}
function el(n){return document.createElementNS('http://www.w3.org/2000/svg',n)}
function esc(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function wireDelete(svg){svg.addEventListener('click',e=>{const g=e.target.closest('.glyph');if(g){document.querySelectorAll('.glyph.selected').forEach(x=>x.classList.remove('selected'));g.classList.add('selected')}})}
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&document.querySelector('.glyph.selected')){e.preventDefault();document.querySelector('.glyph.selected').remove()}});
$('#clearResult').onclick=()=>{$('#paper').className='paper empty';$('#paper').innerHTML='<span>Noch kein Ergebnis</span>';generatedSvg=null;$('#downloadSvg').disabled=true;$('#downloadPng').disabled=true};
$('#downloadSvg').onclick=()=>{if(generatedSvg){const clone=generatedSvg.cloneNode(true);clone.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),'schriftbot-ergebnis.svg')}};
$('#downloadPng').onclick=()=>{if(!generatedSvg)return;const data=new XMLSerializer().serializeToString(generatedSvg);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=+generatedSvg.getAttribute('width');c.height=+generatedSvg.getAttribute('height');c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>downloadBlob(b,'schriftbot-ergebnis.png'),'image/png')};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data)};
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}