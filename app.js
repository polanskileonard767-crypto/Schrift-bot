const $=s=>document.querySelector(s);
const chars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:-_()äöüÄÖÜß/";
let sampleImage=null, generatedSvg=null;

function bindRange(id,out){const e=$(id),o=$(out);const f=()=>o.value=e.value;e.addEventListener('input',f);f()}
bindRange('#size','#sizeOut');bindRange('#lineHeight','#lineOut');bindRange('#variation','#varOut');

$('#sampleInput').addEventListener('change',e=>{const file=e.target.files?.[0];if(file) loadSample(file)});
const dz=$('#dropZone');
['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor='#6366f1'}));
['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor=''}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer.files?.[0];if(f?.type.startsWith('image/'))loadSample(f)});

function loadSample(file){const img=new Image();img.onload=()=>{sampleImage=img;$('#previewWrap').classList.remove('hidden');const c=$('#sampleCanvas'),ctx=c.getContext('2d');const scale=Math.min(1,900/img.width);c.width=img.width*scale;c.height=img.height*scale;ctx.drawImage(img,0,0,c.width,c.height);$('#sampleStatus').textContent=`${img.width}×${img.height} · bereit`};img.src=URL.createObjectURL(file)}

$('#copySample').onclick=async()=>{const text=$('#sampleText').textContent.trim();try{await navigator.clipboard.writeText(text);$('#copySample').textContent='✓ Kopiert';setTimeout(()=>$('#copySample').textContent='Text kopieren',1600)}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();$('#copySample').textContent='✓ Kopiert';setTimeout(()=>$('#copySample').textContent='Text kopieren',1600)}};

$('#downloadTemplate').onclick=()=>{const svg=makeTemplate();downloadBlob(new Blob([svg],{type:'image/svg+xml'}),'schriftbot-vorlage.svg')};

function makeTemplate(){const list=[...chars];const cols=9,cellW=105,cellH=80,pad=25,rows=Math.ceil(list.length/cols),w=cols*cellW+pad*2,h=rows*cellH+pad*2;let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial;font-size:12px;fill:#555}.cell{fill:none;stroke:#ddd}.char{font-size:11px}</style>`;list.forEach((ch,i)=>{const x=pad+(i%cols)*cellW,y=pad+Math.floor(i/cols)*cellH;s+=`<rect class="cell" x="${x}" y="${y}" width="${cellW}" height="${cellH}"/><text class="char" x="${x+6}" y="${y+15}">${esc(ch)}</text><line x1="${x+8}" y1="${y+55}" x2="${x+cellW-8}" y2="${y+55}" stroke="#eee"/>`});return s+'</svg>'}

$('#generate').onclick=()=>{if(!$('#textInput').value.trim()){alert('Bitte zuerst Text eingeben.');return}generatedSvg=renderText($('#textInput').value);const paper=$('#paper');paper.classList.remove('empty');paper.innerHTML='';paper.appendChild(generatedSvg);$('#downloadSvg').disabled=false;$('#downloadPng').disabled=false;document.querySelectorAll('.step')[0].classList.remove('active');document.querySelectorAll('.step')[2].classList.add('active');wireDelete(generatedSvg)};

function renderText(text){const size=+$('#size').value,lh=+$('#lineHeight').value,variation=+$('#variation').value;const lines=text.replace(/\r/g,'').split('\n');const maxChars=Math.max(35,...lines.map(x=>x.length));const width=Math.min(1600,Math.max(760,maxChars*size*.58+80));const height=Math.max(420,lines.length*size*lh+70);const svg=el('svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.style.fontFamily='cursive';let y=size+18;
lines.forEach(line=>{let x=28;for(const ch of [...line]){if(ch===' '){x+=size*.36;continue}const g=el('g');g.classList.add('glyph');g.dataset.char=ch;const rot=(Math.random()-.5)*variation;const scale=1+(Math.random()-.5)*variation/100;g.setAttribute('transform',`translate(${x} ${y}) rotate(${rot}) scale(${scale})`);const t=el('text');t.textContent=ch;t.setAttribute('font-size',size);t.setAttribute('dominant-baseline','alphabetic');t.setAttribute('fill','#111');t.setAttribute('stroke','none');g.appendChild(t);svg.appendChild(g);x+=measure(ch,size)+size*.03}y+=size*lh});return svg}
function measure(ch,size){if('ilI.,!|'.includes(ch))return size*.28;if('mwMW@'.includes(ch))return size*.82;return size*.55}
function el(name){return document.createElementNS('http://www.w3.org/2000/svg',name)}
function esc(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function wireDelete(svg){svg.addEventListener('click',e=>{const g=e.target.closest('.glyph');if(g){document.querySelectorAll('.glyph.selected').forEach(x=>x.classList.remove('selected'));g.classList.add('selected')}})}
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&document.querySelector('.glyph.selected')){e.preventDefault();document.querySelector('.glyph.selected').remove()}});
$('#clearResult').onclick=()=>{$('#paper').className='paper empty';$('#paper').innerHTML='<span>Noch kein Ergebnis</span>';generatedSvg=null;$('#downloadSvg').disabled=true;$('#downloadPng').disabled=true};
$('#downloadSvg').onclick=()=>{if(generatedSvg){const clone=generatedSvg.cloneNode(true);clone.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}),'schriftbot-ergebnis.svg')}};
$('#downloadPng').onclick=()=>{if(!generatedSvg)return;const data=new XMLSerializer().serializeToString(generatedSvg);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=+generatedSvg.getAttribute('width');c.height=+generatedSvg.getAttribute('height');c.getContext('2d').drawImage(img,0,0);c.toBlob(b=>downloadBlob(b,'schriftbot-ergebnis.png'),'image/png')};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data)};
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
