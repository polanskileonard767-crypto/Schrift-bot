const $ = (s) => document.querySelector(s);
const sampleText = $('#sampleText').textContent.trim();
let sampleImage = null;
let generatedSvg = null;
let glyphs = new Map();

function bindRange(id, out) {
  const e = $(id), o = $(out);
  const f = () => o.value = e.value;
  e.addEventListener('input', f);
  f();
}
bindRange('#size', '#sizeOut');
bindRange('#lineHeight', '#lineOut');
bindRange('#variation', '#varOut');

$('#copySample').onclick = async () => {
  try { await navigator.clipboard.writeText(sampleText); }
  catch {
    const a = document.createElement('textarea'); a.value = sampleText;
    document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove();
  }
  $('#copySample').textContent = '✓ Kopiert';
  setTimeout(() => $('#copySample').textContent = 'Text kopieren', 1600);
};

const sampleInput = $('#sampleInput');
sampleInput.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) loadSample(f);
});

const dz = $('#dropZone');
['dragenter', 'dragover'].forEach(x => dz.addEventListener(x, e => {
  e.preventDefault(); dz.style.borderColor = '#6366f1';
}));
['dragleave', 'drop'].forEach(x => dz.addEventListener(x, e => {
  e.preventDefault(); dz.style.borderColor = '';
}));
dz.addEventListener('drop', e => {
  const f = e.dataTransfer?.files?.[0];
  if (f?.type?.startsWith('image/')) loadSample(f);
});

function loadSample(file) {
  if (!file || !file.size) return showUploadError('Die Datei ist leer oder konnte nicht gelesen werden.');
  $('#previewWrap').classList.remove('hidden');
  $('#sampleStatus').textContent = 'Bild wird geladen…';
  $('#analysisText').textContent = 'Handschrift wird analysiert…';
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      sampleImage = img;
      const c = $('#sampleCanvas'), ctx = c.getContext('2d');
      const scale = Math.min(1, 1100 / img.width);
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      $('#sampleStatus').textContent = `✓ ${img.width}×${img.height} · Handschrift wird gelernt…`;
      analyzeSample();
    };
    img.onerror = () => showUploadError('Dieses Bildformat kann der Browser nicht öffnen. Bitte JPG oder PNG verwenden.');
    img.src = reader.result;
  };
  reader.onerror = () => showUploadError('Das Bild konnte nicht gelesen werden. Bitte erneut auswählen.');
  reader.readAsDataURL(file);
}

function showUploadError(message) {
  $('#previewWrap').classList.remove('hidden');
  $('#sampleStatus').textContent = '⚠️ Upload fehlgeschlagen';
  $('#analysisText').textContent = message;
  sampleImage = null;
  glyphs = new Map();
}

function analyzeSample() {
  if (!sampleImage) return;
  glyphs = new Map();
  const src = document.createElement('canvas');
  const scale = Math.min(1, 1800 / sampleImage.width);
  src.width = Math.max(1, Math.round(sampleImage.width * scale));
  src.height = Math.max(1, Math.round(sampleImage.height * scale));
  const ctx = src.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sampleImage, 0, 0, src.width, src.height);
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
  const bg = estimateBackground(data, width, height);
  const ink = new Uint8Array(width * height);
  const rowSum = new Uint32Array(height);
  const threshold = Math.max(25, Math.min(105, colorNoise(data, width, height, bg) + 18));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      if (d > threshold) { ink[y * width + x] = 1; rowSum[y]++; }
    }
  }

  const expectedLines = sampleText.split('\n');
  const lines = chooseLineBands(findLineBands(rowSum, width, height), expectedLines.length, height);
  let total = 0;

  for (let li = 0; li < expectedLines.length; li++) {
    const chars = [...expectedLines[li]].filter(ch => ch !== ' ');
    const band = lines[li];
    if (!chars.length || !band) continue;
    const segs = segmentKnownLine(ink, width, height, band, chars);
    for (let i = 0; i < chars.length; i++) {
      const seg = segs[i];
      if (!seg) continue;
      const crop = makeGlyphCrop(src, ink, seg[0], band[0], seg[1], band[1]);
      if (!crop) continue;
      if (!glyphs.has(chars[i])) glyphs.set(chars[i], []);
      glyphs.get(chars[i]).push(crop);
      total++;
    }
  }

  addAliases();
  const unique = glyphs.size;
  $('#sampleStatus').textContent = `✓ ${unique} Handschrift-Zeichen gelernt`;
  $('#analysisText').textContent = total
    ? `✓ Handschrift erkannt: ${unique} Zeichen. Hintergrund wird nicht mitkopiert.`
    : '⚠️ Keine Handschrift erkannt. Bitte den kompletten Screenshot mit gut sichtbarer Schrift hochladen.';
}

function estimateBackground(data, w, h) {
  const pts = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 35));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (x < step * 3 || y < step * 3 || x > w - step * 4 || y > h - step * 4) {
        const i = (y * w + x) * 4;
        pts.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  if (!pts.length) return [255, 255, 255];
  const bins = new Map();
  for (const p of pts) {
    const key = `${Math.round(p[0] / 16)},${Math.round(p[1] / 16)},${Math.round(p[2] / 16)}`;
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const best = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  return best.map(v => v * 16);
}

function colorNoise(data, w, h, bg) {
  const vals = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 80));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    vals.push(Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]));
  }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.8)] || 8;
}

function findLineBands(rowSum, width, height) {
  const hits = [];
  const threshold = Math.max(2, Math.floor(width * 0.0015));
  let on = false, start = 0;
  for (let y = 0; y < height; y++) {
    const hit = rowSum[y] > threshold;
    if (hit && !on) { start = y; on = true; }
    if ((!hit || y === height - 1) && on) {
      const end = y - (hit ? 0 : 1);
      if (end - start >= 2) hits.push([start, end]);
      on = false;
    }
  }
  if (!hits.length) return [];
  const out = [hits[0].slice()];
  for (let i = 1; i < hits.length; i++) {
    const p = out[out.length - 1], c = hits[i];
    const gap = c[0] - p[1], ph = p[1] - p[0] + 1;
    if (gap < Math.max(10, ph * 0.65)) p[1] = c[1]; else out.push(c.slice());
  }
  return out;
}

function chooseLineBands(lines, count, height) {
  if (lines.length === count) return lines;
  if (lines.length > count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i * lines.length / count);
      const b = Math.max(a, Math.floor((i + 1) * lines.length / count) - 1);
      out.push([lines[a][0], lines[b][1]]);
    }
    return out;
  }
  const margin = Math.round(height * 0.025), usable = Math.max(1, height - margin * 2), out = [];
  for (let i = 0; i < count; i++) out.push([margin + Math.round(usable * i / count), margin + Math.round(usable * (i + 1) / count) - 1]);
  return out;
}

function segmentKnownLine(ink, width, height, band, chars) {
  const y0 = Math.max(0, band[0]), y1 = Math.min(height - 1, band[1]);
  const xs = new Uint32Array(width);
  for (let x = 0; x < width; x++) for (let y = y0; y <= y1; y++) xs[x] += ink[y * width + x];
  let left = 0; while (left < width && xs[left] === 0) left++;
  let right = width - 1; while (right > left && xs[right] === 0) right--;
  if (right <= left) return [];

  const wanted = chars.length;
  const raw = [];
  for (let i = 0; i <= wanted; i++) raw.push(Math.round(left + (right - left) * i / wanted));
  const valleys = [];
  const valleyLimit = Math.max(1, Math.floor((y1 - y0 + 1) * 0.02));
  for (let x = left + 2; x < right - 2; x++) {
    if (xs[x] <= valleyLimit && xs[x] <= xs[x - 1] && xs[x] <= xs[x + 1]) valleys.push(x);
  }
  const cuts = [];
  for (let i = 1; i < wanted; i++) {
    const target = raw[i];
    let best = target, bestDist = Infinity;
    for (const v of valleys) {
      const d = Math.abs(v - target);
      if (d < bestDist && d < Math.max(20, (right - left) / wanted * 0.5)) { best = v; bestDist = d; }
    }
    cuts.push(best);
  }
  const segs = [], minW = Math.max(3, Math.floor((right - left) / wanted * 0.28));
  let s = left;
  for (const c of cuts) {
    const cut = Math.max(s + minW, Math.min(right - minW, c));
    segs.push([s, cut - 1]); s = cut + 1;
  }
  segs.push([s, right]);
  return segs;
}

function makeGlyphCrop(src, ink, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(src.width - 1, Math.ceil(x1)); y1 = Math.min(src.height - 1, Math.ceil(y1));
  let bx0 = x1, by0 = y1, bx1 = x0, by1 = y0, found = false;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink[y * src.width + x]) {
    found = true; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (!found) return null;
  const pad = Math.max(3, Math.round((by1 - by0 + 1) * 0.08));
  bx0 = Math.max(x0, bx0 - pad); bx1 = Math.min(x1, bx1 + pad); by0 = Math.max(y0, by0 - pad); by1 = Math.min(y1, by1 + pad);
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const pixels = sctx.getImageData(bx0, by0, w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const out = c.getContext('2d'); const img = out.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y * w + x) * 4;
    if (ink[(by0 + y) * src.width + bx0 + x]) {
      img.data[si] = pixels.data[si]; img.data[si + 1] = pixels.data[si + 1]; img.data[si + 2] = pixels.data[si + 2]; img.data[si + 3] = Math.max(120, pixels.data[si + 3]);
    }
  }
  out.putImageData(img, 0, 0);
  return { src: c.toDataURL('image/png'), width: w, height: h, advance: w, baseline: h * 0.88 };
}

function addGlyphAlias(from, to) { const a = glyphs.get(from); if (a?.length && !glyphs.has(to)) glyphs.set(to, a); }
function addAliases() {
  addGlyphAlias('a', 'ä'); addGlyphAlias('o', 'ö'); addGlyphAlias('u', 'ü');
  addGlyphAlias('A', 'Ä'); addGlyphAlias('O', 'Ö'); addGlyphAlias('U', 'Ü');
  addGlyphAlias('s', 'ß');
}

$('#downloadTemplate').onclick = () => downloadBlob(new Blob([makeTemplate()], { type: 'image/svg+xml' }), 'schriftbot-vorlage.svg');
function makeTemplate() {
  const lines = sampleText.split('\n'), w = 1400, h = lines.length * 110 + 100;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial;fill:#555}.guide{stroke:#dfe3ea}</style>`;
  lines.forEach((line, i) => { const y = 70 + i * 110; s += `<text x="35" y="${y - 35}" font-size="13">Zeile ${i + 1}: genau diese Zeile abschreiben</text><line class="guide" x1="35" y1="${y + 12}" x2="${w - 35}" y2="${y + 12}"/><text x="35" y="${y}" font-size="17">${esc(line)}</text>`; });
  return s + '</svg>';
}

$('#generate').onclick = () => {
  const text = $('#textInput').value.trim();
  if (!text) return alert('Bitte zuerst Text eingeben.');
  if (!sampleImage || !glyphs.size) return alert('Bitte zuerst eine Handschriftprobe hochladen.');
  generatedSvg = renderText(text);
  const paper = $('#paper'); paper.classList.remove('empty'); paper.innerHTML = ''; paper.appendChild(generatedSvg);
  $('#downloadSvg').disabled = false; $('#downloadPng').disabled = false; $('#copyNotes').disabled = false;
  document.querySelectorAll('.step')[0].classList.remove('active');
  document.querySelectorAll('.step')[1].classList.add('active'); document.querySelectorAll('.step')[2].classList.add('active');
  wireDelete(generatedSvg);
};

function findGlyph(ch) {
  if (glyphs.has(ch)) return glyphs.get(ch);
  const lower = ch.toLowerCase(), upper = ch.toUpperCase();
  if (glyphs.has(lower)) return glyphs.get(lower);
  if (glyphs.has(upper)) return glyphs.get(upper);
  return null;
}

function renderText(text) {
  const size = +$('#size').value, lh = +$('#lineHeight').value, variation = +$('#variation').value;
  const lines = text.replace(/\r/g, '').split('\n');
  const width = Math.min(1800, Math.max(760, ...lines.map(line => estimateLineWidth(line, size)) + 60));
  const height = Math.max(300, lines.length * size * lh + 80);
  const svg = el('svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', width); svg.setAttribute('height', height); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  let y = 28;
  lines.forEach(line => {
    let x = 28;
    const baseline = y + size * 0.82;
    for (const ch of [...line]) {
      if (ch === ' ') { x += size * 0.34; continue; }
      const list = findGlyph(ch), g = el('g');
      g.classList.add('glyph'); g.dataset.char = ch;
      if (list?.length) {
        const sample = list[Math.floor(Math.random() * list.length)];
        const targetH = size * (0.88 + (Math.random() - 0.5) * variation / 100);
        const targetW = targetH * sample.width / Math.max(1, sample.height);
        const rot = (Math.random() - 0.5) * variation;
        const yTop = baseline - targetH * (sample.baseline / sample.height);
        g.setAttribute('transform', `rotate(${rot} ${x + targetW / 2} ${baseline})`);
        const img = el('image'); img.setAttribute('href', sample.src); img.setAttribute('x', x); img.setAttribute('y', yTop); img.setAttribute('width', targetW); img.setAttribute('height', targetH); img.setAttribute('preserveAspectRatio', 'none');
        g.appendChild(img); svg.appendChild(g);
        x += Math.max(size * 0.18, targetW * 0.92) + size * 0.025;
      } else {
        const t = el('text'); t.textContent = ch; t.setAttribute('x', x); t.setAttribute('y', baseline); t.setAttribute('font-size', size); t.setAttribute('dominant-baseline', 'alphabetic'); t.setAttribute('fill', '#111');
        g.appendChild(t); svg.appendChild(g); x += measure(ch, size) + size * 0.03;
      }
    }
    y += size * lh;
  });
  return svg;
}

function estimateLineWidth(line, size) {
  let w = 0;
  for (const ch of [...line]) {
    const list = findGlyph(ch);
    if (ch === ' ') w += size * 0.34;
    else if (list?.length) { const g = list[0]; w += size * 0.88 * g.width / Math.max(1, g.height) + size * 0.025; }
    else w += measure(ch, size) + size * 0.03;
  }
  return w;
}
function measure(ch, size) { if ('ilI.,!|'.includes(ch)) return size * 0.28; if ('mwMW@'.includes(ch)) return size * 0.82; return size * 0.55; }
function el(name) { return document.createElementNS('http://www.w3.org/2000/svg', name); }
function esc(s) { return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

function wireDelete(svg) {
  svg.addEventListener('click', e => {
    const g = e.target.closest('.glyph');
    if (g) { document.querySelectorAll('.glyph.selected').forEach(x => x.classList.remove('selected')); g.classList.add('selected'); }
  });
}
document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && document.querySelector('.glyph.selected')) { e.preventDefault(); document.querySelector('.glyph.selected').remove(); }
});

$('#clearResult').onclick = () => {
  $('#paper').className = 'paper empty'; $('#paper').innerHTML = '<span>Noch kein Ergebnis</span>';
  generatedSvg = null; $('#downloadSvg').disabled = true; $('#downloadPng').disabled = true; $('#copyNotes').disabled = true;
};

$('#downloadSvg').onclick = () => {
  if (!generatedSvg) return;
  const clone = generatedSvg.cloneNode(true); clone.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
  downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }), 'schriftbot-ergebnis.svg');
};

async function renderPngBlob() {
  if (!generatedSvg) return null;
  const clone = generatedSvg.cloneNode(true); clone.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml' }));
  return new Promise(resolve => {
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = +generatedSvg.getAttribute('width'); c.height = +generatedSvg.getAttribute('height');
      const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url);
      c.toBlob(resolve, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

$('#downloadPng').onclick = async () => {
  const blob = await renderPngBlob();
  if (blob) downloadBlob(blob, 'schriftbot-ergebnis.png');
};

$('#copyNotes').onclick = async () => {
  const blob = await renderPngBlob();
  if (!blob) return;
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard image unsupported');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    $('#copyNotes').textContent = '✓ Bild kopiert';
    $('#analysisText').textContent = '✓ Bild kopiert. Jetzt Samsung Notes öffnen und Einfügen wählen.';
  } catch {
    downloadBlob(blob, 'schriftbot-notizen.png');
    $('#copyNotes').textContent = '✓ PNG gespeichert';
    $('#analysisText').textContent = '✓ PNG gespeichert. In Samsung Notes über Bild/Galerie einfügen.';
  }
  setTimeout(() => $('#copyNotes').textContent = '📋 Für Notizen kopieren', 2200);
};

function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
