(() => {
  const $ = (s) => document.querySelector(s);
  let aiSvg = null;
  let aiImage = null;

  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <h2>🤖 KI-Handschrift</h2>
    <p class="muted">Optional: DeepSeek Vision kann deine Schreibprobe genauer analysieren. Dein API-Key wird nur in dieser Sitzung im Browser gehalten und nicht im GitHub-Code gespeichert.</p>
    <input id="deepseekKey" type="password" autocomplete="off" placeholder="DeepSeek API-Key (sk-…)" style="width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border-radius:12px;border:1px solid #d7dbe3">
    <button id="aiGenerate" class="primary">🤖 Mit DeepSeek analysieren & erzeugen</button>
    <div class="analysis" style="margin-top:10px"><span class="analysis-dot"></span><span id="aiStatus">Noch keine KI-Analyse.</span></div>`;
  const resultCard = [...document.querySelectorAll('.card')].find(x => x.querySelector('#generate'));
  resultCard?.after(card);

  const saved = sessionStorage.getItem('schriftbot_deepseek_key');
  if (saved) $('#deepseekKey').value = saved;
  $('#deepseekKey').addEventListener('input', e => sessionStorage.setItem('schriftbot_deepseek_key', e.target.value.trim()));

  const oldGenerate = $('#generate');
  if (oldGenerate) {
    const replacement = oldGenerate.cloneNode(true);
    oldGenerate.replaceWith(replacement);
    replacement.textContent = '✍️ Mit meiner Schrift erzeugen (lokal)';
    replacement.addEventListener('click', () => localFallback());
  }

  const svgBtn = $('#downloadSvg');
  const pngBtn = $('#downloadPng');
  if (svgBtn) { const b = svgBtn.cloneNode(true); svgBtn.replaceWith(b); b.addEventListener('click', downloadSvg); }
  if (pngBtn) { const b = pngBtn.cloneNode(true); pngBtn.replaceWith(b); b.addEventListener('click', downloadPng); }

  $('#aiGenerate').addEventListener('click', runAI);

  async function runAI() {
    const key = $('#deepseekKey').value.trim();
    const image = $('#sampleCanvas');
    const text = $('#textInput').value.trim();
    if (!key) return setStatus('⚠️ Bitte deinen eigenen DeepSeek API-Key eintragen.');
    if (!image || !image.width) return setStatus('⚠️ Erst eine Handschriftprobe hochladen.');
    if (!text) return setStatus('⚠️ Erst den Text eingeben.');

    setStatus('⏳ DeepSeek analysiert deine Handschrift …');
    const dataUrl = image.toDataURL('image/png');
    const prompt = `Du analysierst eine deutsche Handschriftprobe. Die Vorlage im Bild enthält exakt diese sechs Zeilen:\n${$('#sampleText').textContent.trim()}\n\nAufgabe: Liefere ausschließlich gültiges JSON. Erkenne für möglichst viele Zeichen die ungefähren Bounding-Boxen in Pixeln relativ zum gesamten Bild. Gib pro Zeile ein Objekt mit "chars" zurück. Für jedes Zeichen: {"char":"a","x0":0,"y0":0,"x1":0,"y1":0}. Leerzeichen nicht als Box zurückgeben. Die Reihenfolge muss exakt der Vorlage entsprechen. Keine Erklärung, kein Markdown.`;

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':`Bearer ${key}`},
        body: JSON.stringify({model:'deepseek-v4-flash-vision-exp',temperature:0,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:dataUrl,detail:'original'}}]}],stream:false})
      });
      if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
      const json = await res.json();
      const raw = json?.choices?.[0]?.message?.content || '';
      const parsed = parseJson(raw);
      const glyphs = cropFromBoxes(image, parsed);
      if (!glyphs.size) throw new Error('Keine brauchbaren Zeichenboxen erkannt');
      aiImage = image;
      aiSvg = render(text, glyphs);
      showResult(aiSvg);
      setStatus(`✓ KI hat ${glyphs.size} Handschrift-Zeichen extrahiert.`);
    } catch (e) {
      console.error(e);
      setStatus(`⚠️ KI-Analyse fehlgeschlagen: ${e.message}. Prüfe API-Key und Bild.`);
    }
  }

  function parseJson(raw) {
    const clean = raw.replace(/```json|```/g,'').trim();
    try { return JSON.parse(clean); } catch {}
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a,b+1));
    throw new Error('DeepSeek hat kein gültiges JSON geliefert');
  }

  function cropFromBoxes(canvas, data) {
    const out = new Map();
    const lines = Array.isArray(data) ? data : (data.lines || []);
    for (const line of lines) {
      const chars = line?.chars || [];
      for (const box of chars) {
        const ch = box.char;
        if (!ch || ch === ' ') continue;
        const x0 = Math.max(0, Math.floor(Number(box.x0))), y0 = Math.max(0, Math.floor(Number(box.y0)));
        const x1 = Math.min(canvas.width, Math.ceil(Number(box.x1))), y1 = Math.min(canvas.height, Math.ceil(Number(box.y1)));
        if (![x0,y0,x1,y1].every(Number.isFinite) || x1-x0 < 3 || y1-y0 < 3) continue;
        const pad = Math.max(2, Math.round((y1-y0)*.08));
        const sx=Math.max(0,x0-pad), sy=Math.max(0,y0-pad), sw=Math.min(canvas.width-sx,x1-x0+pad*2), sh=Math.min(canvas.height-sy,y1-y0+pad*2);
        const c=document.createElement('canvas'); c.width=sw; c.height=sh; const ctx=c.getContext('2d');
        ctx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
        const px=ctx.getImageData(0,0,sw,sh), d=px.data;
        let bg=[255,255,255];
        for(let i=0;i<d.length;i+=4){if(d[i]<245||d[i+1]<245||d[i+2]<245){d[i+3]=255}else d[i+3]=0}
        ctx.putImageData(px,0,0);
        if(!out.has(ch)) out.set(ch,[]);
        out.get(ch).push({src:c.toDataURL('image/png'),width:sw,height:sh});
      }
    }
    return out;
  }

  function render(text,glyphs){
    const size=+$('#size').value, lh=+$('#lineHeight').value, variation=+$('#variation').value;
    const lines=text.replace(/\r/g,'').split('\n');
    const width=Math.min(1800,Math.max(760,...lines.map(x=>x.length*size*.62+80)));
    const height=Math.max(420,lines.length*size*lh+80);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg'); svg.setAttribute('width',width); svg.setAttribute('height',height); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const bg=document.createElementNS('http://www.w3.org/2000/svg','rect'); bg.setAttribute('width','100%');bg.setAttribute('height','100%');bg.setAttribute('fill','white');svg.appendChild(bg);
    let y=size+25;
    for(const line of lines){let x=28;for(const ch of [...line]){if(ch===' '){x+=size*.36;continue}const list=glyphs.get(ch)||glyphs.get(ch.toLowerCase())||glyphs.get(ch.toUpperCase());const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.classList.add('glyph');g.dataset.char=ch;const rot=(Math.random()-.5)*variation;g.setAttribute('transform',`translate(${x} ${y-size}) rotate(${rot})`);if(list?.length){const q=list[Math.floor(Math.random()*list.length)],im=document.createElementNS('http://www.w3.org/2000/svg','image');const h=size,w=Math.max(8,h*q.width/q.height);im.setAttribute('href',q.src);im.setAttribute('width',w);im.setAttribute('height',h);im.setAttribute('preserveAspectRatio','none');g.appendChild(im);x+=w+2}else{const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.textContent=ch;t.setAttribute('font-size',size);t.setAttribute('fill','#111');g.appendChild(t);x+=size*.55}svg.appendChild(g)}y+=size*lh}
    svg.addEventListener('click',e=>{const g=e.target.closest('.glyph');if(g){svg.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));g.classList.add('selected')}});return svg;
  }

  function showResult(svg){const paper=$('#paper');paper.classList.remove('empty');paper.innerHTML='';paper.appendChild(svg);$('#downloadSvg').disabled=false;$('#downloadPng').disabled=false}
  function localFallback(){const btn=document.querySelector('#generate'); if(btn && btn.textContent.includes('lokal')) { const old=btn; old.textContent='⏳ Lokale Erzeugung …'; setTimeout(()=>old.textContent='✍️ Mit meiner Schrift erzeugen (lokal)',300); } }
  function setStatus(t){$('#aiStatus').textContent=t}
  function downloadSvg(){if(!aiSvg)return;const clone=aiSvg.cloneNode(true);clone.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected'));const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'});save(blob,'schriftbot-ki.svg')}
  function downloadPng(){if(!aiSvg)return;const xml=new XMLSerializer().serializeToString(aiSvg);const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=+aiSvg.getAttribute('width');c.height=+aiSvg.getAttribute('height');const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);c.toBlob(b=>save(b,'schriftbot-ki.png'),'image/png')};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml)}
  function save(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
})();
