// src/components/pdfHelpers.js

// ===================== Helpers umum =====================
export function fmtRoman(num, upper = false) {
  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let n = Math.max(1, Math.floor(num)), out = "";
  for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } }
  return upper ? out : out.toLowerCase();
}

export async function resolveDestToLocation(pdf, dest) {
  const explicitDest = Array.isArray(dest) ? dest : await pdf.getDestination(dest);
  if (!explicitDest) return null;
  const [ref, mode, x, y, zoom] = explicitDest;
  const pageIndex = await pdf.getPageIndex(ref);
  const pageNum = pageIndex + 1;
  const pdfX = typeof x === "number" ? x : 0;
  const pdfY = typeof y === "number" ? y : 0;
  return { pageNum, pdfX, pdfY, zoom: typeof zoom === "number" ? zoom : null, explicitDest };
}

export async function flattenOutlineRecursive(pdf, items, level = 1) {
  const out = [];
  if (!items) return out;
  for (const it of items) {
    let loc = null;
    try { if (it.dest) loc = await resolveDestToLocation(pdf, it.dest); } catch { loc = null; }
    out.push({
      id: cryptoRandomId("sec"),
      title: it.title || "Untitled",
      level,
      loc: loc ? { pageNum: loc.pageNum, pdfX: loc.pdfX, pdfY: loc.pdfY, zoom: loc.zoom } : null,
      explicitDest: loc ? loc.explicitDest : null,
    });
    if (it.items && it.items.length) {
      const kids = await flattenOutlineRecursive(pdf, it.items, level + 1);
      out.push(...kids);
    }
  }
  return out;
}

function cryptoRandomId(prefix = "id") {
  try {
    const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    return `${prefix}_${rand}`;
  } catch {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function romanToInt(s) {
  const map = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  const S = String(s || "").toUpperCase();
  let total = 0, prev = 0;
  for (let i = S.length - 1; i >= 0; i--) {
    const val = map[S[i]] || 0;
    if (val < prev) total -= val; else total += val;
    prev = val;
  }
  return total;
}

async function safeGetPageLabels(pdf) {
  try { return await pdf.getPageLabels(); }
  catch { return null; }
}

// ===================== TOC (Daftar Isi) → Halaman PDF =====================

/**
 * Detect TOC multi-halaman dari isi PDF dan map ke NOMOR HALAMAN PDF nyata.
 * Kebijakan:
 *  - Default **abaikan token romawi** (i, ii, iii) agar tak nyangkut ke cover.
 *  - Default **abaikan pageLabels** saat pemetaan TOC → fokus ke halaman PDF.
 *  - Hitung **offset berbasis konten** dari beberapa judul TOC (arabic):
 *      cari halaman PDF yang paling cocok (pakai teks header), ambil median offset.
 *  - Refinement lokal ±3 halaman untuk koreksi kecil.
 */
export async function detectTOC(
  pdf,
  {
    maxScanPages = 60,
    pageLabels = null,
    maxTOCSpanPages = 8,
    maxDepth = 2,
    includeFigures = false,
    indentSlack = 42,
    ignoreRomanTokens = true,        // abaikan entri TOC yang pakai romawi
    ignorePageLabelsInTOC = true,    // abaikan pageLabels saat memetakan TOC
  } = {}
) {
  const labels = ignorePageLabelsInTOC ? null : (pageLabels || (await safeGetPageLabels(pdf)));
  const pagesToScan = Math.min(pdf.numPages, maxScanPages);

  // 1) cari halaman awal TOC
  let startTOCPage = null;
  for (let p = 1; p <= pagesToScan; p++) {
    const lines = await extractPageLines(pdf, p);
    if (!lines.length) continue;
    if (isTOCPage(lines)) { startTOCPage = p; break; }
  }
  if (!startTOCPage) return [];

  // 2) sapu beberapa halaman TOC berturut-turut
  let tocEntries = [];
  let span = 0;
  for (let p = startTOCPage; p <= pagesToScan && span < maxTOCSpanPages; p++, span++) {
    const lines = await extractPageLines(pdf, p);
    if (!lines.length) break;
    if (!isTOCPage(lines)) break;

    const parsed = lines.map((l) => parseTOCLineFromLine(l)).filter(Boolean);
    tocEntries.push(...parsed);
  }
  if (!tocEntries.length) return [];

  // 2b) Opsi: buang entri romawi agar tidak memetakan ke cover/dll
  if (ignoreRomanTokens) {
    tocEntries = tocEntries.filter(e => isArabicToken(e.pageToken));
  }

  // 3) Hitung offset ARABIC berbasis konten (median dari beberapa entry yang ditemukan)
  const arabicOffset = await estimateArabicOffsetByContent(pdf, tocEntries, { minPage: 3, scanLimit: 160 });

  // 4) Mapper sederhana: gunakan label (jika dipakai) atau gunakan arabicOffset
  const mapper = (token) => {
    if (!token) return null;
    // Jika kamu memutuskan untuk pakai labels (ignorePageLabelsInTOC=false) dan match persis:
    if (labels) {
      const labelIndex = buildLabelIndex(labels);
      const byLabel = labelIndex.get(token);
      if (byLabel) return byLabel;
    }
    if (isArabicToken(token)) {
      const n = parseInt(token, 10);
      return clamp(n + arabicOffset, 1, pdf.numPages);
    }
    // token romawi diabaikan (atau bisa di-handle offset terpisah kalau mau)
    return null;
  };

  // 5) filter & susun sections awal (rapikan judul, jaga monotonic naik)
  const banPrefix = /^(figure|fig\.|table|tab\.|appendix|lampiran|gambar|tabel)\b/i;
  const minIndent = Math.min(...tocEntries.map((e) => e.indent ?? 0));
  const allowedIndent = (lvl) => minIndent + indentSlack * (lvl - 1 + 0.15);

  let sections = [];
  let lastPage = 0;
  let lastKey = "";

  for (const { title, pageToken, indent } of tocEntries) {
    if (!includeFigures && banPrefix.test(title)) continue;

    const pageNum = mapper(pageToken);
    if (!pageNum) continue;

    const level = guessLevelFromTitle(title);
    if (level > maxDepth) continue;
    if (typeof indent === "number" && indent > allowedIndent(level)) continue;

    const key = `${pageNum}|${title.slice(0, 120)}`;
    if (pageNum < lastPage) continue;      // jaga urutan naik
    if (key === lastKey) continue;         // hindari duplikat berurutan

    sections.push({
      id: cryptoRandomId("sec"),
      title: cleanTOCTitle(title),
      level,
      page: pageNum,      // <-- SELALU halaman PDF
      pdfX: 0,
      pdfY: null,
      dest: null,
    });

    lastPage = Math.max(lastPage, pageNum);
    lastKey = key;
  }

  // 6) refinement lokal ±3 halaman
  sections = await refinePagesByContent(pdf, sections, { window: 3 });

  return dedupeSequential(sections);
}


export async function detectTOCByLinks(
  pdf,
  {
    maxScanPages = 60,
    maxTOCSpanPages = 8,
    indentSlack = 42,
    maxDepth = 2,
    includeFigures = false,
    mergeYTolerance = 10,
    mergeXTolerance = 30,
  } = {}
) {
  const pagesToScan = Math.min(pdf.numPages, maxScanPages);

  // cari halaman awal TOC
  let startTOCPage = null;
  for (let p = 1; p <= pagesToScan; p++) {
    const lines = await extractPageLines(pdf, p);
    if (lines.length && isTOCPage(lines)) { startTOCPage = p; break; }
  }
  if (!startTOCPage) return [];

  const rawEntries = [];
  const banPrefix = /^(figure|fig\.|table|tab\.|appendix|lampiran|gambar|tabel)\b/i;

  let span = 0;
  for (let tocPage = startTOCPage; tocPage <= pagesToScan && span < maxTOCSpanPages; tocPage++, span++) {
    const page = await pdf.getPage(tocPage);
    const viewport = page.getViewport({ scale: 1 });
    const lines = await extractPageLines(pdf, tocPage);
    if (!lines.length || !isTOCPage(lines)) break;

    const minIndent = Math.min(...lines.map(l => l.x_min ?? 0));
    const allowedIndent = (lvl) => minIndent + indentSlack * (lvl - 1 + 0.15);

    const annots = await page.getAnnotations({ intent: "display" });

    const temp = [];
    for (const a of annots) {
      if (a?.subtype !== "Link") continue;

      let targetPage = null;
      let destArray = null;
      let pdfX = 0;
      let pdfY = null;

      if (a.dest) {
        try {
          const loc = await resolveDestToLocation(pdf, a.dest);
          if (loc?.pageNum) {
            targetPage = loc.pageNum;
            destArray  = loc.explicitDest || null;
            pdfX = typeof loc.pdfX === "number" ? loc.pdfX : 0;
            pdfY = typeof loc.pdfY === "number" ? loc.pdfY : null;
          }
        } catch {}
      } else if (a.url || a.unsafeUrl) {
        const u = String(a.url || a.unsafeUrl);
        const m = /[#?&]page=(\d+)/i.exec(u);
        if (m) targetPage = parseInt(m[1], 10);
      }
      if (!targetPage) continue;

      const rect = Array.isArray(a.rect) ? a.rect : null;
      const vrect = rect ? viewport.convertToViewportRectangle(rect) : null;

      const lineObj =
        pickLineObjByRect(lines, vrect) ||
        pickNearestLineObjByRect(lines, vrect);
      if (!lineObj) continue;

      const parsed = parseTOCLine(lineObj.text);
      const rawTitle = parsed?.title || cleanTOCTitle(lineObj.text);
      const title = cleanTOCTitle(rawTitle);
      if (!title) continue;
      if (!includeFigures && banPrefix.test(title)) continue;

      const level = guessLevelFromTitle(title);
      if (level > maxDepth) continue;

      const indent = lineObj.x_min ?? minIndent;
      if (indent > allowedIndent(level)) continue;

      temp.push({
        tocPage,
        lineIdx: lineObj.idx ?? 0,
        midY: (lineObj.y_min + lineObj.y_max) / 2,
        indent,
        targetPage,
        destArray,
        pdfX,
        pdfY,
        title,
        level,
      });
    }

    temp.sort((a, b) => a.lineIdx - b.lineIdx || a.midY - b.midY);
    rawEntries.push(...temp);
  }

  if (!rawEntries.length) return [];

  const merged = mergeMultiLineTOCLinkEntries(rawEntries, {
    yTol: mergeYTolerance,
    xTol: mergeXTolerance,
  });

  // pertahankan urutan TOC (jangan sort by page)
  const sections = [];
  let lastKey = "";
  for (const e of merged) {
    const key = `${e.page}|${e.title.slice(0, 120)}`;
    if (key === lastKey) continue;
    sections.push({
      id: cryptoRandomId("sec"),
      title: e.title,
      level: e.level,
      page: e.page,                 // halaman PDF riil
      pdfX: e.pdfX ?? 0,            // <— simpan koordinat dari dest
      pdfY: e.pdfY ?? null,         // <— simpan koordinat dari dest
      dest: e.destArray || null,    // dest asli hyperlink
      source: "toc_link",
    });
    lastKey = key;
  }

  return sections;
}



// Ambil line object yang overlap dengan rect link
function pickLineObjByRect(lines, vrect) {
  if (!vrect || !lines?.length) return null;
  const [x1, y1, x2, y2] = vrect; // viewport coords
  const midY = (y1 + y2) / 2;
  let best = null, bestDist = Infinity;

  for (const ln of lines) {
    const overlapX = !(x2 < ln.x_min || x1 > ln.x_max);
    if (!overlapX) continue;
    const lnMid = (ln.y_min + ln.y_max) / 2;
    const d = Math.abs(lnMid - midY);
    if (d < bestDist) { best = ln; bestDist = d; }
  }
  return best;
}

function pickNearestLineObjByRect(lines, vrect) {
  if (!lines?.length) return null;
  const midY = vrect ? (vrect[1] + vrect[3]) / 2 : null;
  let best = null, bestDist = Infinity;
  for (const ln of lines) {
    const lnMid = (ln.y_min + ln.y_max) / 2;
    const d = midY != null ? Math.abs(lnMid - midY) : Math.abs(lnMid - (lines[0]?.y_min ?? 0));
    if (d < bestDist) { best = ln; bestDist = d; }
  }
  return best;
}

/**
 * Gabung beberapa baris judul (multi-line) yang:
 *  - targetPage sama
 *  - jarak vertikal antar baris kecil (yTol)
 *  - indent/kolom mirip (xTol)
 * Ambil level terendah (angka terbesar) untuk hasil merge.
 */
// GANTI fungsi lama:
function mergeMultiLineTOCLinkEntries(entries, { yTol = 10, xTol = 30 } = {}) {
  const groups = [];
  for (const e of entries) {
    const g = groups.length ? groups[groups.length - 1] : null;

    const canMerge =
      g &&
      (e.tocPage === g.tocPage) &&
      Math.abs(g.lastMidY - e.midY) <= yTol &&
      Math.abs(g.indent - e.indent) <= xTol &&
      looksLikeContinuation(g.title, e.title);

    if (canMerge) {
      g.title = mergeTitle(g.title, e.title);
      g.level = Math.min(g.level, e.level);
      g.lastMidY = e.midY;
      // page/pdfX/pdfY/dest tetap dari baris pertama agar konsisten
    } else {
      groups.push({
        tocPage: e.tocPage,
        lineIdx: e.lineIdx,
        lastMidY: e.midY,
        indent: e.indent,
        title: e.title,
        level: e.level,
        page: e.targetPage,
        pdfX: e.pdfX ?? 0,
        pdfY: e.pdfY ?? null,
        destArray: e.destArray || null,
      });
    }
  }

  return groups.map(g => ({
    page: g.page,
    title: cleanTOCTitle(g.title),
    level: g.level,
    pdfX: g.pdfX ?? 0,
    pdfY: g.pdfY ?? null,
    destArray: g.destArray || null,
  }));
}




// TAMBAHKAN helper berikut:
function looksLikeContinuation(prevTitle, nextTitle) {
  const A = cleanTOCTitle(prevTitle || "");
  const B = cleanTOCTitle(nextTitle || "");
  if (!A || !B) return false;

  // 1) Jika baris berikutnya jelas bernomor / item baru → JANGAN merge
  if (isNumberedTitle(B) || startsWithAppendixOrFigure(B)) return false;

  // 2) Continuation heuristics:
  //   - baris berikutnya diawali huruf kecil / tanda hubung
  //   - atau baris pertama tampak “menggantung” (tidak berakhir dengan titik/koma/colon)
  const startsLowerOrHyphen = /^[a-z\-]/.test(B);
  const prevLooksHanging = !/[.:;]$/.test(A) && A.length >= 12; // kalimat panjang tanpa akhir jelas
  const sharePrefix = sharesFirstToken(A, B); // token pertama sama → kemungkinan lanjutan

  return startsLowerOrHyphen || prevLooksHanging || sharePrefix;
}

function isNumberedTitle(t) {
  const s = (t || "").trim();
  return (
    // 1, 1.1, 2.3.4)
    /^\d+(\.\d+)*[\)\.]?\s+/.test(s) ||
    // (a) a) b.
    /^[\(\[]?[a-zA-Z][\)\.\]]\s+/.test(s) ||
    // Roman: I., II., iv)
    /^[ivxlcdmIVXLCDM]+[\)\.]?\s+/.test(s)
  );
}

function startsWithAppendixOrFigure(t) {
  return /^(figure|fig\.|table|tab\.|appendix|lampiran|gambar|tabel)\b/i.test(t || "");
}

function sharesFirstToken(a, b) {
  const A = (a || "").toLowerCase().split(/\s+/).filter(Boolean);
  const B = (b || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!A.length || !B.length) return false;
  return A[0] === B[0] && A[0].length > 2; // token pertama sama & bukan sangat pendek
}


// gabung dua potongan judul dengan spasi tunggal, hindari duplikasi
function mergeTitle(a, b) {
  const A = cleanTOCTitle(a || "");
  const B = cleanTOCTitle(b || "");
  if (!A) return B;
  if (!B) return A;
  if (A.endsWith(B) || B.startsWith(A)) return cleanTOCTitle(`${A} ${B}`);
  return cleanTOCTitle(`${A} ${B}`);
}


// ——— helpers kecil untuk rect ↔ line
function pickLineTextByRect(lines, vrect) {
  if (!vrect || !lines?.length) return null;
  const [x1, y1, x2, y2] = vrect; // viewport coords, origin top-left
  const midY = (y1 + y2) / 2;
  let best = null, bestDist = Infinity;

  for (const ln of lines) {
    // overlap X minimal, dan Y tengah mendekati baris
    const overlapX = !(x2 < ln.x_min || x1 > ln.x_max);
    if (!overlapX) continue;
    const lnMid = (ln.y_min + ln.y_max) / 2;
    const d = Math.abs(lnMid - midY);
    if (d < bestDist) { best = ln; bestDist = d; }
  }
  return best?.text || null;
}

function pickNearestLineTextByRect(lines, vrect) {
  if (!lines?.length) return null;
  const midY = vrect ? (vrect[1] + vrect[3]) / 2 : null;
  let best = null, bestDist = Infinity;
  for (const ln of lines) {
    const lnMid = (ln.y_min + ln.y_max) / 2;
    const d = midY != null ? Math.abs(lnMid - midY) : Math.abs(lnMid - (lines[0]?.y_min ?? 0));
    if (d < bestDist) { best = ln; bestDist = d; }
  }
  return best?.text || null;
}

function findLineForTitle(lines, title) {
  const key = (title || "").replace(/\s+/g, " ").trim().toLowerCase();
  return lines.find(l => l.text.toLowerCase() === key) || null;
}


// ----- Estimasi offset berbasis konten -----

async function estimateArabicOffsetByContent(pdf, tocEntries, {
  minPage = 3,        // hindari cover/ halaman kosong di awal
  scanLimit = 160,    // batas halaman yang discan untuk mencari judul
  sample = 8,         // jumlah entri TOC arabic yang dicoba
  acceptScore = 0.22, // minimal skor untuk dianggap cocok
} = {}) {
  const N = Math.min(pdf.numPages, scanLimit);
  const candidates = [];
  const arabicEntries = tocEntries
    .filter(e => isArabicToken(e.pageToken) && (e.title || "").trim().length >= 3)
    .slice(0, sample);

  for (const e of arabicEntries) {
    const n = parseInt(e.pageToken, 10);
    const key = titleKey(e.title);
    if (!key) continue;

    let bestPage = null;
    let bestScore = -1;

    // Cari di seluruh rentang yang wajar (minPage..N)
    for (let p = Math.max(minPage, 1); p <= N; p++) {
      const head = await pageHeaderText(pdf, p);
      const s = titleMatchScore(key, head);
      if (s > bestScore) { bestScore = s; bestPage = p; }
    }
    if (bestPage != null && bestScore >= acceptScore) {
      candidates.push(bestPage - n);
    }
  }

  if (!candidates.length) return 0; // fallback: tidak ketemu → offset 0 (nanti masih ada refinement lokal)

  // median offset agar robust terhadap outlier
  candidates.sort((a,b)=>a-b);
  const mid = Math.floor(candidates.length / 2);
  const offset = (candidates.length % 2)
    ? candidates[mid]
    : Math.round((candidates[mid - 1] + candidates[mid]) / 2);

  // batasi offset agar tidak liar
  return clamp(offset, -200, 400);
}

// halaman dikatakan “TOC” jika ada header atau ≥5 baris dot-leader
function isTOCPage(lines) {
  const textBlock = lines.map((l) => l.text).join("\n");
  const hasTOCHeader = /(^|\s)(daftar\s+isi|table\s+of\s+contents|contents)(\s|$)/i.test(textBlock);
  const dotLeaderLines = lines.filter((l) => isDotLeaderLine(l.text)).length;
  if (hasTOCHeader) return true;
  return dotLeaderLines >= 5;
}

// deteksi baris "Judul ..... 12" (variasi titik/bullet/long-spaces & "hal."/ "page")
function isDotLeaderLine(text) {
  if (!text) return false;
  const t = String(text).replace(/\s+/g, " ").trim();
  return /.+?(?:\.{2,}|·{2,}|[\.\s]{4,})\s*(?:hal\.?|page)?\s*(\d+|[ivxlcdm]+)$/i.test(t);
}

// parse 1 baris TOC + bawa indent (x_min)
function parseTOCLineFromLine(line) {
  const { text, x_min } = line || {};
  const parsed = parseTOCLine(text);
  if (!parsed) return null;
  return { ...parsed, indent: typeof x_min === "number" ? x_min : 0 };
}

// parser baris TOC → { title, pageToken }
function parseTOCLine(text) {
  if (!text) return null;
  let t = text
    .replace(/[•●○∙·⋅]+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/\s*\.*\s*$/g, "");

  const m = /(.+?)(?:\.{2,}|·{2,}|[\.\s]{4,})\s*(?:hal\.?|page)?\s*([a-z0-9]+)$/i.exec(t);
  if (m) {
    const title = m[1].trim().replace(/\s*\.*\s*$/g, "");
    const pageToken = cleanPageToken(m[2]);
    if (title && pageToken) return { title, pageToken };
  }

  // fallback: ambil token angka/roman paling kanan
  const parts = t.split(" ");
  for (let i = parts.length - 1; i >= 0; i--) {
    const tok = cleanPageToken(parts[i]);
    if (!tok) continue;
    if (isArabicToken(tok) || isRomanToken(tok)) {
      const title = t.slice(0, t.lastIndexOf(parts[i])).trim().replace(/\s*\.*\s*$/g, "");
      if (title) return { title, pageToken: tok };
      break;
    }
  }
  return null;
}

function cleanPageToken(s) {
  if (!s) return "";
  return s.replace(/[()\[\],.:]+$/g, "").replace(/^[()\[\],.:]+/g, "").trim();
}

function cleanTOCTitle(s) {
  return (s || "").replace(/\s*\.*\s*$/g, "").replace(/\s+/g, " ").trim();
}

// token helpers
function isRomanToken(t) { return /^[ivxlcdm]+$/i.test(t || ""); }
function isArabicToken(t) { return /^\d+$/.test(t || ""); }

// ===================== Refinement berbasis konten =====================

async function refinePagesByContent(pdf, sections, { window = 3 } = {}) {
  const out = [];
  for (const s of sections) {
    const best = await findBestPageForTitle(pdf, s.title, s.page, window);
    out.push({ ...s, page: best ?? s.page });
  }
  return out;
}

async function findBestPageForTitle(pdf, title, guessPage, window = 3) {
  const targetKey = titleKey(title);
  if (!targetKey) return guessPage;

  let bestPage = guessPage;
  let bestScore = -1;

  const start = clamp(guessPage - window, 1, pdf.numPages);
  const end   = clamp(guessPage + window, 1, pdf.numPages);

  for (let p = start; p <= end; p++) {
    const head = await pageHeaderText(pdf, p);
    const score = titleMatchScore(targetKey, head);
    if (score > bestScore) { bestScore = score; bestPage = p; }
  }

  // hanya terima jika ada kecocokan minimal
  return bestScore >= 0.15 ? bestPage : guessPage;
}

async function pageHeaderText(pdf, pageNum) {
  const lines = await extractPageLines(pdf, pageNum);
  const head = lines.slice(0, 8).map(l => l.text).join(" ").toLowerCase();
  return head.replace(/\s+/g, " ").trim();
}

function titleKey(title) {
  const t = (title || "")
    .toLowerCase()
    .replace(/^[\divxlcdm\.\)\s-]+/, "")          // hapus prefix nomor/roman
    .replace(/[^\p{L}\p{N}\s]/gu, " ")            // buang simbol
    .replace(/\s+/g, " ")
    .trim();
  return t.split(" ").filter(w => w.length > 2).slice(0, 6).join(" ");
}

function titleMatchScore(key, hay) {
  if (!key || !hay) return 0;
  if (hay.includes(key)) return 1;

  const a = new Set(key.split(" "));
  const b = new Set(hay.split(" "));
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const j = inter / Math.max(1, a.size + b.size - inter);

  const seqBonus = sequentialPresenceBonus(key.split(" "), hay.split(" "));
  return Math.max(j, seqBonus * 0.6);
}

function sequentialPresenceBonus(tokens, words) {
  let i = 0;
  for (const w of words) {
    if (w === tokens[i]) i++;
    if (i >= tokens.length) break;
  }
  return i / Math.max(1, tokens.length);
}

// ===================== Ekstraksi teks halaman & heading fallback =====================

async function extractPageLines(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = (content.items || [])
    .map((it) => {
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const y = tr[5];
      const height = Math.max(Math.abs(tr[3] || 0), Math.abs(tr[1] || 0), 8);
      return { str: it.str || "", x, y: viewport.height - y, height };
    })
    .filter((it) => it.str && it.str.trim());

  const lines = groupLinesByY_coarse(items, 2.2).map((ln, idx) => ({
    idx,
    y_min: ln.y_min,
    y_max: ln.y_max,
    x_min: ln.x_min,
    x_max: ln.x_max,
    height: ln.height,
    text: ln.items.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim(),
  }));

  lines.sort((a, b) => a.y_min - b.y_min || a.x_min - b.x_min);
  return lines;
}

export async function detectHeadings(pdf, { maxPages = 80 } = {}) {
  const out = [];
  const pageCount = pdf.numPages;
  const N = Math.min(pageCount, maxPages);

  for (let p = 1; p <= N; p++) {
    const lines = await extractPageLines(pdf, p);
    if (!lines.length) continue;

    const heights = lines.map((l) => l.height).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 10;

    const isHeadingLike = (txt) => {
      if (!txt || txt.length <= 3) return false;
      const numbered = /^\d+(\.\d+)*[\)\.]?\s+/.test(txt);
      const veryShort = txt.length <= 80;
      return numbered || veryShort;
    };

    const cand = lines.filter(
      (l) => l.height >= 1.35 * medH && l.x_min <= 140 && isHeadingLike(l.text)
    );

    cand.sort((a, b) => a.y_min - b.y_min || a.x_min - b.x_min);
    const topCand = cand.slice(0, 3);

    topCand.forEach((c) => {
      out.push({
        id: cryptoRandomId("sec"),
        title: c.text,
        level: guessLevelFromTitle(c.text),
        page: p,
        pdfX: 0,
        pdfY: null,
        dest: null,
      });
    });
  }

  out.sort((a, b) => a.page - b.page);
  return dedupeSequential(out);
}

function groupLinesByY_coarse(items, tolY = 2.0) {
  const arr = items.slice().sort((A, B) => A.y - B.y); // top->bottom
  const lines = [];
  let cur = [], curY = null;

  for (const it of arr) {
    if (curY === null || Math.abs(it.y - curY) <= tolY) {
      cur.push(it);
      if (curY === null) curY = it.y;
    } else {
      lines.push(cur); cur = [it]; curY = it.y;
    }
  }
  if (cur.length) lines.push(cur);

  return lines.map((ln) => {
    const ys = ln.map((t) => t.y),
          xs = ln.map((t) => t.x),
          hs = ln.map((t) => t.height).sort((a, b) => a - b);
    return {
      y_min: Math.min(...ys),
      y_max: Math.max(...ys),
      x_min: Math.min(...xs),
      x_max: Math.max(...xs),
      height: hs[Math.floor(hs.length / 2)] || 12,
      items: ln,
    };
  });
}

function guessLevelFromTitle(t) {
  const m = /^\d+(\.\d+)*/.exec(t);
  if (!m) return 1;
  const depth = (m[0].match(/\./g) || []).length + 1;
  return Math.min(3, Math.max(1, depth));
}

function dedupeSequential(arr) {
  const out = [];
  let lastKey = "";
  for (const a of arr) {
    const key = `${a.page}|${(a.title || "").slice(0, 120)}`;
    if (key !== lastKey) out.push(a);
    lastKey = key;
  }
  return out;
}
