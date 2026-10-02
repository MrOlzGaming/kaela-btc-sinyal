// indicatorStudy.js (3 Okt 2026) -- Olan: "pelajari indikator ini prinsipnya.. belajar yang benar dan mendalam".
// Kode Pine ASLI 4 indikator TradingView diambil (open-source, pine-facade) lalu logika intinya ditulis ulang
// SETIA di sini, dan KLAIM tiap indikator diuji pakai data BTC asli (spot 5m 2019-09..2026-10, diagregasi ke 1H/4H):
//
//   1. FVG Order Blocks [BigBeluga]: zona "OB" = dari tepi bawah FVG (high[2]) turun 1x ATR(200); sinyal ︽ = candle
//      sebelumnya nyentuh/masuk atap zona, candle ini low-nya udah di atas atap (mantul). Filter gap > 0,5% harga.
//   2. Smart Money Concepts AI [Adaptive] (DefinedEdge): struktur pivot(5) close-break BOS/CHoCH, FVG 3-candle (candle
//      tengah searah), OB = candle lawan terakhir sebelum break, skor 5 faktor (tabel poin tetap), sinyal = harga
//      nyentuh FVG aktif searah struktur+EMA50, konfluens = skorFVG*0,45 + skorOB_overlap*0,35 + 20 >= 50 (★ >= 70).
//   3. Structure Break Volume Profile (erdensedat): pivot fraktal 13 (6 kiri/kanan), break = close tembus, CHoCH ->
//      volume profile 50 baris dari struktur sebelumnya -> POC; sinyal = sentuhan PERTAMA ke POC setelah CHoCH, searah
//      CHoCH. (Versi asli cuma ngitung POC di bar terakhir chart -> historinya gak keliatan; di sini dihitung pas CHoCH
//      dari data yang udah ada = non-repaint.)
// Penilaian: return maju H candle searah sinyal dari close candle sinyal, dipotong fee 0,12% RT, dibanding BASELINE
// (rata2 return maju SEMUA candle searah yg sama). DEV = < 2023, HOLD = >= 2023.
// Pakai: node backtest/indicatorStudy.js <btc-5m-2019-2026.json>

const fs = require('fs');
const FEE = 0.12;
const SPLIT = Date.UTC(2023, 0, 1);

function aggregate(c5, min) {
  const ms = min * 60e3, out = [];
  let cur = null;
  for (const x of c5) {
    const b = Math.floor(x.openTime / ms) * ms;
    if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: x.open, h: x.high, l: x.low, c: x.close, v: x.volume || 0 }; }
    else { cur.h = Math.max(cur.h, x.high); cur.l = Math.min(cur.l, x.low); cur.c = x.close; cur.v += x.volume || 0; }
  }
  if (cur) out.push(cur);
  return out;
}
function atrRma(c, len) {
  const out = new Array(c.length).fill(null); let a = null;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[i].h - c[i].l : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i < len) { a = (a || 0) + tr; if (i === len - 1) { a /= len; out[i] = a; } }
    else { a = (a * (len - 1) + tr) / len; out[i] = a; }
  }
  return out;
}
function ema(arr, len) { const out = new Array(arr.length).fill(null); const k = 2 / (len + 1); let e = null; for (let i = 0; i < arr.length; i++) { e = e === null ? arr[i] : arr[i] * k + e * (1 - k); if (i >= len - 1) out[i] = e; } return out; }
function sma(arr, len) { const out = new Array(arr.length).fill(null); let s = 0; for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= len) s -= arr[i - len]; if (i >= len - 1) out[i] = s / len; } return out; }
// pivot high di index p (dikonfirmasi di p+len): high[p] > semua high di [p-len, p+len] lainnya
function pivotAt(c, p, len, hi) {
  if (p - len < 0 || p + len >= c.length) return false;
  const v = hi ? c[p].h : c[p].l;
  for (let j = p - len; j <= p + len; j++) { if (j === p) continue; if (hi ? c[j].h >= v && j > p : c[j].l <= v && j > p) return false; if (hi ? c[j].h > v : c[j].l < v) return false; }
  return true;
}

// ---------- 1. BigBeluga ----------
function bigBeluga(c, filter = 0.5, boxAmount = 6) {
  const atr = atrRma(c, 200), ev = [];
  let bull = [], bear = [];
  for (let i = 2; i < c.length; i++) {
    const x = c[i], a = c[i - 2], m = c[i - 1];
    const fu = (x.l - a.h) / x.l * 100, fd = (a.l - x.h) / a.l * 100;
    const isBull = a.h < x.l && a.h < m.h && a.l < x.l && fu > filter;
    const isBear = a.l > x.h && a.l > m.l && a.h > x.h && fd > filter;
    if (isBull && atr[i] !== null) bull.push({ top: a.h, bottom: a.h - atr[i] });
    if (isBear && atr[i] !== null) bear.push({ top: a.l + atr[i], bottom: a.l });
    let sigL = false, sigS = false;
    bull = bull.filter((b) => !(x.h < b.bottom));
    for (const b of bull) if (x.l > b.top && m.l <= b.top && !isBull) sigL = true;
    bull = bull.filter((b) => !bull.some((o) => o !== b && o.top < b.top && o.top > b.bottom));
    bear = bear.filter((b) => !(x.l > b.top));
    for (const b of bear) if (x.h < b.bottom && m.h >= b.bottom && !isBear) sigS = true;
    bear = bear.filter((b) => !bear.some((o) => o !== b && o.top < b.top && o.top > b.bottom));
    if (bull.length >= boxAmount) bull.shift();
    if (bear.length >= boxAmount) bear.shift();
    if (sigL) ev.push({ i, dir: 1 });
    if (sigS) ev.push({ i, dir: -1 });
  }
  return ev;
}

// ---------- 2. SMC AI ----------
function smcAi(c, opt = {}) {
  const swLen = opt.swLen || 5, minSc = 50, bright = 70, cd = 10;
  const close = c.map((x) => x.c), vol = c.map((x) => x.v);
  const trendMa = ema(close, 50), atr = atrRma(c, 14), volMa = sma(vol, 20);
  let structDir = 0, sh1 = null, sl1 = null, sh1bar = 0, sl1bar = 0, sh1b = false, sl1b = false;
  let fB = [], fS = [], oB = [], oS = [];
  let lastSig = -1e9;
  const sig = [], fvgLog = [];
  const scoreFVG = (g, d, v, t, s) => Math.min((g < 0.15 ? 3 : g < 0.3 ? 12 : g < 0.8 ? 25 : g < 1.5 ? 20 : g < 2.5 ? 12 : 5) + (d > 0.8 ? 25 : d > 0.6 ? 20 : d > 0.4 ? 15 : d > 0.2 ? 8 : 3) + (v > 2 ? 20 : v > 1.5 ? 16 : v > 1 ? 12 : v > 0.7 ? 8 : 4) + (t ? 20 : 8) + (s ? 10 : 3), 100);
  const scoreOB = (o, d, v, t, s) => Math.min((o < 0.2 ? 5 : o < 0.5 ? 15 : o < 1 ? 20 : o < 2 ? 12 : 5) + (d > 3 ? 30 : d > 2 ? 25 : d > 1 ? 18 : d > 0.5 ? 10 : 5) + (v > 2 ? 20 : v > 1.5 ? 16 : v > 1 ? 12 : v > 0.7 ? 8 : 4) + (t ? 20 : 8) + (s ? 10 : 3), 100);
  for (let n = 0; n < c.length; n++) {
    const x = c[n], A = atr[n] || (x.h - x.l);
    const p = n - swLen;
    if (p >= swLen && pivotAt(c, p, swLen, true)) { sh1 = c[p].h; sh1bar = p; sh1b = false; }
    if (p >= swLen && pivotAt(c, p, swLen, false)) { sl1 = c[p].l; sl1bar = p; sl1b = false; }
    const bullBreak = n > 0 && sh1 !== null && !sh1b && x.c > sh1 && c[n - 1].c <= sh1;
    const bearBreak = n > 0 && sl1 !== null && !sl1b && x.c < sl1 && c[n - 1].c >= sl1;
    if (bullBreak) { sh1b = true; structDir = 1; }
    if (bearBreak) { sl1b = true; structDir = -1; }
    // FVG
    if (n >= 2 && trendMa[n - 1] !== null && volMa[n - 1] !== null) {
      const m = c[n - 1], a = c[n - 2];
      const midDisp = (m.h - m.l) > 0 ? Math.abs(m.c - m.o) / (m.h - m.l) : 0.5, vR = volMa[n - 1] ? m.v / volMa[n - 1] : 1;
      if (x.l > a.h && m.c > m.o) {
        const sc = scoreFVG((x.l - a.h) / A, midDisp, vR, m.c > trendMa[n - 1], structDir >= 0);
        const z = { top: x.l, btm: a.h, sc, act: true, sig: false, n, dir: 1 };
        fB.unshift(z); fvgLog.push(z); if (fB.length > 5) fB.pop();
      }
      if (x.h < a.l && m.c < m.o) {
        const sc = scoreFVG((a.l - x.h) / A, midDisp, vR, m.c < trendMa[n - 1], structDir <= 0);
        const z = { top: a.l, btm: x.h, sc, act: true, sig: false, n, dir: -1 };
        fS.unshift(z); fvgLog.push(z); if (fS.length > 5) fS.pop();
      }
    }
    for (const z of fB) if (z.act && x.c < z.btm) { z.act = false; z.mitN = n; }
    for (const z of fS) if (z.act && x.c > z.top) { z.act = false; z.mitN = n; }
    // OB
    if (bullBreak && volMa[n] !== null) {
      const look = Math.max(Math.min(n - sh1bar, 30), 1);
      for (let i = 1; i <= look && n - i >= 0; i++) { const k = c[n - i]; if (k.c < k.o) { const top = k.o, btm = k.c; oB.unshift({ top, btm, act: true, sc: scoreOB((top - btm) / A, (x.c - top) / A, k.v / volMa[n], x.c > trendMa[n], true) }); break; } }
      if (oB.length > 3) oB.pop();
    }
    if (bearBreak && volMa[n] !== null) {
      const look = Math.max(Math.min(n - sl1bar, 30), 1);
      for (let i = 1; i <= look && n - i >= 0; i++) { const k = c[n - i]; if (k.c > k.o) { const top = k.c, btm = k.o; oS.unshift({ top, btm, act: true, sc: scoreOB((top - btm) / A, (btm - x.c) / A, k.v / volMa[n], x.c < trendMa[n], true) }); break; } }
      if (oS.length > 3) oS.pop();
    }
    for (const o of oB) if (o.act && x.c < o.btm) o.act = false;
    for (const o of oS) if (o.act && x.c > o.top) o.act = false;
    // sinyal
    if (trendMa[n] !== null && n - lastSig > cd) {
      for (const [dir, F, O, ok] of [[1, fB, oB, structDir > 0 && x.c > trendMa[n]], [-1, fS, oS, structDir < 0 && x.c < trendMa[n]]]) {
        if (!ok) continue;
        let best = 0, bestZ = null;
        for (const z of F) {
          if (!z.act || z.sig) continue;
          if (x.l <= z.top && x.h >= z.btm) {
            let os = 0;
            for (const o of O) if (o.act && o.top > z.btm && z.top > o.btm) os = Math.max(os, o.sc);
            const conf = z.sc * 0.45 + os * 0.35 + 20;
            if (conf > best) { best = conf; z.sig = true; bestZ = z; }
          }
        }
        if (best >= minSc) { sig.push({ i: n, dir, score: best, bright: best >= bright, fvgScore: bestZ.sc }); lastSig = n; }
      }
    }
  }
  return { sig, fvgLog };
}

// ---------- 3. Structure Break Volume Profile ----------
function sbvp(c, fractal = 12, rows = 50) {
  const odd = fractal % 2 === 0 ? fractal + 1 : fractal, ps = Math.floor(odd / 2);
  let up = null, upT = null, upB = false, lo = null, loT = null, loB = false, dir = 0;
  let aH = null, aHT = null, aL = null, aLT = null;
  let poc = null, chochN = null, chochDir = 0, touched = false;
  const ev = [];
  for (let n = 0; n < c.length; n++) {
    const p = n - ps;
    if (p >= ps && pivotAt(c, p, ps, true)) { up = c[p].h; upT = p; upB = false; if (dir !== 0 && (aH === null || up > aH)) { aH = up; aHT = p; } }
    if (p >= ps && pivotAt(c, p, ps, false)) { lo = c[p].l; loT = p; loB = false; if (dir !== 0 && (aL === null || lo < aL)) { aL = lo; aLT = p; } }
    // sentuhan POC (sebelum break di bar ini diproses -> pakai POC aktif)
    if (poc !== null && !touched && n > chochN && c[n].l <= poc && c[n].h >= poc) { ev.push({ i: n, dir: chochDir }); touched = true; }
    const x = c[n];
    for (const side of [1, -1]) {
      const brk = side === 1 ? (up !== null && !upB && x.c > up) : (lo !== null && !loB && x.c < lo);
      if (!brk) continue;
      const isChoch = dir === -side;
      const startsNew = dir !== side;
      if (side === 1) upB = true; else loB = true;
      if (isChoch) {
        if (aH !== null && aL !== null && aHT !== null && aLT !== null && aH > aL) {
          const s = Math.min(aHT, aLT), e = n - 1, rh = (aH - aL) / rows, vols = new Array(rows).fill(0);
          for (let k = s; k <= e; k++) {
            const b = c[k], cl = Math.max(b.l, aL), ch = Math.min(b.h, aH), v = b.v > 0 ? b.v : 1;
            if (ch > cl) { const f = Math.min(rows - 1, Math.max(0, Math.floor((cl - aL) / rh))), t = Math.min(rows - 1, Math.max(0, Math.floor((ch - aL) / rh))); for (let r = f; r <= t; r++) { const rb = aL + r * rh, ov = Math.max(Math.min(ch, rb + rh) - Math.max(cl, rb), 0); vols[r] += v * ov / (ch - cl); } }
            else if (b.c >= aL && b.c <= aH) vols[Math.min(rows - 1, Math.max(0, Math.floor((b.c - aL) / rh)))] += v;
          }
          let mx = 0, pr = 0; for (let r = 0; r < rows; r++) if (vols[r] > mx) { mx = vols[r]; pr = r; }
          poc = mx > 0 ? aL + (pr + 0.5) * rh : null; chochN = n; chochDir = side; touched = false;
        } else poc = null;
      }
      if (startsNew) { aH = up; aHT = upT; aL = lo; aLT = loT; }
      dir = side;
    }
  }
  return ev;
}

// ---------- penilaian ----------
function evaluate(c, events, H) {
  const rows = [];
  for (const e of events) { const j = e.i + H; if (j >= c.length) continue; const r = (c[j].c - c[e.i].c) / c[e.i].c * 100 * e.dir; rows.push({ ...e, t: c[e.i].t, net: r - FEE }); }
  return rows;
}
function baseline(c, H, dir) { let s = 0, n = 0; for (let i = 0; i + H < c.length; i++) { s += (c[i + H].c - c[i].c) / c[i].c * 100 * dir; n++; } return s / n; }
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : String(v));
function line(label, rows, c, H) {
  const part = (rs) => { if (!rs.length) return 'n=0'; const w = rs.filter((r) => r.net > 0).length; let gw = 0, gl = 0; for (const r of rs) { if (r.net > 0) gw += r.net; else gl -= r.net; } const base = rs.reduce((a, r) => a + baseline.cache[`${H}|${r.dir}`], 0) / rs.length; const avg = rs.reduce((a, r) => a + r.net, 0) / rs.length; return `n=${rs.length} win=${f(w / rs.length * 100, 0)}% PF=${f(gl ? gw / gl : Infinity)} avg=${f(avg, 3)}% (vs acak ${f(base - FEE, 3)}%)`; };
  return `${label.padEnd(44)} DEV ${part(rows.filter((r) => r.t < SPLIT))} || HOLD ${part(rows.filter((r) => r.t >= SPLIT))}`;
}

(function main() {
  const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (const [tfName, min, Hs] of [['4H', 240, [6, 12, 24, 42]], ['1H', 60, [6, 24, 48, 96]]]) {
    const c = aggregate(c5, min);
    baseline.cache = {};
    for (const H of Hs) for (const d of [1, -1]) baseline.cache[`${H}|${d}`] = baseline(c, H, d);
    console.log(`\n================ BTC ${tfName}: ${c.length} candle ${new Date(c[0].t).toISOString().slice(0, 10)} -> ${new Date(c.at(-1).t).toISOString().slice(0, 10)} ================`);
    const bb = bigBeluga(c);
    const { sig: smc, fvgLog } = smcAi(c);
    const sb = sbvp(c);
    for (const H of Hs) {
      console.log(`-- tahan ${H} candle (${H * min / 60} jam), fee ${FEE}% --`);
      for (const [lab, ev] of [
        ['1 BigBeluga ︽/﹀ semua', bb], ['1 BigBeluga long', bb.filter((e) => e.dir === 1)], ['1 BigBeluga short', bb.filter((e) => e.dir === -1)],
        ['2 SMC AI semua sinyal (>=50)', smc], ['2 SMC AI ★ terang (>=70)', smc.filter((e) => e.bright)], ['2 SMC AI ○ redup (50-69)', smc.filter((e) => !e.bright)],
        ['2 SMC AI long', smc.filter((e) => e.dir === 1)], ['2 SMC AI short', smc.filter((e) => e.dir === -1)],
        ['3 SBVP sentuh POC pertama abis CHoCH', sb], ['3 SBVP long (CHoCH naik)', sb.filter((e) => e.dir === 1)], ['3 SBVP short (CHoCH turun)', sb.filter((e) => e.dir === -1)],
      ]) console.log(line(lab, evaluate(c, ev, H), c, H));
    }
    // apakah skor FVG SMC AI beneran prediktif? -> tingkat FVG yang "bertahan" (gak dimitigasi) 24 candle & return maju 24
    console.log('-- uji skor FVG SMC AI: per kelompok skor, % FVG yang BERTAHAN (gak ditutup tembus) 24 candle + return maju 24 searah FVG --');
    for (const [a, b] of [[0, 40], [40, 55], [55, 70], [70, 85], [85, 101]]) {
      const zs = fvgLog.filter((z) => z.sc >= a && z.sc < b && z.n + 24 < c.length);
      if (!zs.length) continue;
      const hold = zs.filter((z) => !(z.mitN !== undefined && z.mitN <= z.n + 24)).length;
      const ret = zs.reduce((s, z) => s + (c[z.n + 24].c - c[z.n].c) / c[z.n].c * 100 * z.dir, 0) / zs.length;
      console.log(`skor ${String(a).padStart(2)}-${b - 1}: n=${zs.length} bertahan ${f(hold / zs.length * 100, 0)}% | return maju 24 rata2 ${f(ret, 3)}%`);
    }
  }
})();
