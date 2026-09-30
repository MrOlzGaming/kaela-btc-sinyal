// ninjaFvgBacktest.js (1 Okt 2026) -- backtest NINJA versi baru: entry dari SENTUHAN FVG (ganti
// Channel Breakout 5M). Spesifikasi dari Olan (chat 30 Sep-1 Okt 2026), ringkas:
//   - Deteksi FVG di timeframe NINJA sendiri (5M/15M/1H, diuji semua) -- konsep "FVG Order Blocks
//     [BigBeluga]": gap 3-candle + filter lebar minimum (% harga) + dibuang begitu termitigasi
//     (candle CLOSE nembus sisi jauh). Ini replikasi KONSEP, bukan salinan kode Pine aslinya.
//   - Tiap FVG punya ID unik (arah + closeTime candle pembentuk). SATU FVG = MAKS SATU ENTRY.
//   - Entry pas harga BALIK menyentuh FVG (bullish -> BUY di batas atas, bearish -> SELL di batas
//     bawah). Bukan breakout, gak ngejar candle.
//   - SATU posisi aktif. Selama posisi jalan, FVG yang kesentuh DIABAIKAN (gak dikonsumsi, tetap
//     boleh dipakai nanti kalau masih valid & belum termitigasi).
//   - SL/likuidasi = 2 x lebar FVG. Trailing: jarak TETAP 2 x lebar dari harga terbaik sejak entry,
//     ratchet cuma ke arah untung. Exit cuma kalau trailing kena.
//   - Size dari Kalkulator Exposure (calculator.js hitung(), modal = equity/5 sama kayak Ninja
//     live, short = separuh exposure otomatis dari calculator).
//   - Fee dari data ASLI BingX: 0,05%/sisi (dicek dari field commission order demo 23-30 Sep 2026).
//     Stress 0,10%/sisi juga dijalanin.
// Eksekusi disimulasikan di candle 5M (live Ninja polling tiap 1 menit) -- FVG 15M/1H dirakit dari
// candle 5M. Konservatif soal urutan intra-candle: candle tempat entry langsung dicek kena SL awal,
// trailing baru di-ratchet mulai candle SETELAH entry.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchWithRetry } = require('../httpRetry');
const { hitung: hitungExposure } = require('../calculator');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
const CACHE_PATH = process.env.KAELA_5M_CACHE || path.join(os.tmpdir(), 'kaela-btc-5m-cache.json');
const MODAL_ACTIVE_FRACTION = 1 / 5;
const MAX_FVG_PER_SIDE = 10;

function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }

async function fetch5m(startTime, endTime) {
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=BTCUSDT&interval=5m&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    all = all.concat(raw.map(parseCandle));
    const last = raw[raw.length - 1][6];
    if (last <= cursor) break;
    cursor = last + 1;
  }
  return all;
}

async function loadCandles(years) {
  const endTime = Date.now();
  const startTime = endTime - years * 365 * 86400000;
  if (fs.existsSync(CACHE_PATH)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (cached.length && cached[0].openTime <= startTime + 86400000 && cached[cached.length - 1].closeTime >= endTime - 3 * 3600000) return cached;
  }
  const candles = await fetch5m(startTime, endTime);
  fs.writeFileSync(CACHE_PATH, JSON.stringify(candles));
  return candles;
}

function aggregate(candles5m, minutes) {
  if (minutes === 5) return candles5m;
  const ms = minutes * 60000;
  const out = [];
  let bucket = null;
  for (const c of candles5m) {
    const key = Math.floor(c.openTime / ms) * ms;
    if (!bucket || bucket.openTime !== key) {
      if (bucket) out.push(bucket);
      bucket = { openTime: key, open: c.open, high: c.high, low: c.low, close: c.close, closeTime: c.closeTime };
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.closeTime = c.closeTime;
    }
  }
  if (bucket) out.push(bucket);
  // Candle terakhir bisa belum lengkap -- buang biar gak kebentuk FVG dari candle yang belum close.
  if (out.length && out[out.length - 1].closeTime - out[out.length - 1].openTime < ms - 60000) out.pop();
  return out;
}

// FVG dari 3 candle (a=i-2, c=i): bullish kalau low[c] > high[a], bearish kalau high[c] < low[a].
function detectFvgs(tfCandles, minWidthPct) {
  const fvgs = [];
  for (let i = 2; i < tfCandles.length; i++) {
    const a = tfCandles[i - 2], c = tfCandles[i];
    if (c.low > a.high) {
      const top = c.low, bottom = a.high, widthPct = (top - bottom) / top * 100;
      if (widthPct >= minWidthPct) fvgs.push({ id: `bull-${c.closeTime}`, dir: 'buy', top, bottom, widthPct, readyAt: c.closeTime });
    } else if (c.high < a.low) {
      const top = a.low, bottom = c.high, widthPct = (top - bottom) / bottom * 100;
      if (widthPct >= minWidthPct) fvgs.push({ id: `bear-${c.closeTime}`, dir: 'sell', top, bottom, widthPct, readyAt: c.closeTime });
    }
  }
  return fvgs;
}

// Varian riset (BUKAN spec Olan, diuji terpisah buat nyari kenapa spec polos gak punya edge):
//   confirm      -- entry cuma kalau candle 5M yang nyentuh gap juga CLOSE balik di luar gap searah
//                   FVG (konfirmasi pantul, pola yang dipakai Sniper/Ranger), entry di harga close.
//   trendSmaLen  -- FVG cuma diambil searah tren (close TF candle vs SMA N candle TF itu sendiri).
//   trailMult    -- jarak SL/trailing = trailMult x lebar FVG (spec Olan = 2).
function simulate(candles5m, tfMinutes, { minWidthPct, feePctPerSide, startEquity = 100, fromTime = 0, toTime = Infinity, confirm = false, trendSmaLen = 0, trailMult = 2 }) {
  const tfCandles = aggregate(candles5m, tfMinutes);
  let allFvgs = detectFvgs(tfCandles, minWidthPct);
  if (trendSmaLen > 0) {
    const smaAt = new Map();
    let sum = 0;
    for (let i = 0; i < tfCandles.length; i++) {
      sum += tfCandles[i].close;
      if (i >= trendSmaLen) sum -= tfCandles[i - trendSmaLen].close;
      if (i >= trendSmaLen - 1) smaAt.set(tfCandles[i].closeTime, { sma: sum / trendSmaLen, close: tfCandles[i].close });
    }
    allFvgs = allFvgs.filter((f) => {
      const s = smaAt.get(f.readyAt);
      return s && (f.dir === 'buy' ? s.close > s.sma : s.close < s.sma);
    });
  }
  let nextFvg = 0;
  const active = [];
  const consumed = new Set();
  const trades = [];
  let equity = startEquity, peak = startEquity, maxDd = 0;
  let pos = null;

  for (let k = 0; k < candles5m.length; k++) {
    const c = candles5m[k];
    while (nextFvg < allFvgs.length && allFvgs[nextFvg].readyAt < c.openTime) {
      active.push(allFvgs[nextFvg]);
      nextFvg++;
      for (const dir of ['buy', 'sell']) {
        const same = active.filter((f) => f.dir === dir);
        if (same.length > MAX_FVG_PER_SIDE) active.splice(active.indexOf(same[0]), 1);
      }
    }

    if (pos) {
      const hit = pos.dir === 'buy' ? c.low <= pos.stop : c.high >= pos.stop;
      if (hit) {
        closePos(pos.stop, c.closeTime);
      } else {
        if (pos.dir === 'buy') { pos.extreme = Math.max(pos.extreme, c.high); pos.stop = Math.max(pos.stop, pos.extreme * (1 - pos.distPct / 100)); }
        else { pos.extreme = Math.min(pos.extreme, c.low); pos.stop = Math.min(pos.stop, pos.extreme * (1 + pos.distPct / 100)); }
      }
    }

    // Entry DULU baru mitigasi -- live polling 1 menit bakal masuk pas sentuhan pertama, sebelum
    // candle 5M-nya sempat close nembus sisi jauh.
    if (!pos && c.openTime >= fromTime && c.openTime < toTime) {
      // Kandidat yang kesentuh candle ini -- ambil yang TERBARU (paling relevan buat harga sekarang).
      for (let j = active.length - 1; j >= 0; j--) {
        const f = active[j];
        if (consumed.has(f.id)) continue;
        const touched = f.dir === 'buy' ? c.low <= f.top : c.high >= f.bottom;
        if (!touched) continue;
        if (confirm && !(f.dir === 'buy' ? c.close > f.top : c.close < f.bottom)) continue;
        const entry = confirm ? c.close : (f.dir === 'buy' ? f.top : f.bottom);
        const distPct = trailMult * f.widthPct;
        const stop = f.dir === 'buy' ? entry * (1 - distPct / 100) : entry * (1 + distPct / 100);
        const calc = hitungExposure({ modal: equity * MODAL_ACTIVE_FRACTION, entry, stopLoss: stop, direction: f.dir });
        consumed.add(f.id);
        active.splice(j, 1);
        pos = { fvgId: f.id, dir: f.dir, entry, stop, distPct, extreme: entry, notional: calc.nilaiPosisi, openTime: c.openTime, widthPct: f.widthPct };
        // Konservatif: kalau candle yang sama juga nyentuh SL awal, anggap kena.
        // (Mode confirm entry di CLOSE candle -- harga intra-candle sebelum close gak relevan buat SL.)
        const hitSame = f.dir === 'buy' ? c.low <= stop : c.high >= stop;
        if (!confirm && hitSame) closePos(stop, c.closeTime);
        break;
      }
    }

    // Mitigasi (ala BigBeluga): candle CLOSE nembus sisi jauh -> FVG dibuang.
    for (let j = active.length - 1; j >= 0; j--) {
      const f = active[j];
      if ((f.dir === 'buy' && c.close < f.bottom) || (f.dir === 'sell' && c.close > f.top)) active.splice(j, 1);
    }
  }

  function closePos(exitPrice, closeTime) {
    const move = pos.dir === 'buy' ? (exitPrice - pos.entry) / pos.entry : (pos.entry - exitPrice) / pos.entry;
    const gross = pos.notional * move;
    const fee = (pos.notional + pos.notional * (exitPrice / pos.entry)) * feePctPerSide / 100;
    const net = gross - fee;
    equity += net;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak * 100);
    trades.push({ ...pos, exit: exitPrice, closeTime, gross, fee, net, holdMin: (closeTime - pos.openTime) / 60000 });
    pos = null;
  }

  return { trades, equity, maxDd };
}

function summarize(label, r, days) {
  const t = r.trades;
  if (!t.length) return `${label}: 0 trade`;
  const sum = (f) => t.reduce((s, x) => s + f(x), 0);
  const gross = sum((x) => x.gross), fee = sum((x) => x.fee), net = sum((x) => x.net);
  const winNet = t.filter((x) => x.net > 0).length;
  const posNet = sum((x) => (x.net > 0 ? x.net : 0)), negNet = -sum((x) => (x.net < 0 ? x.net : 0));
  const holds = t.map((x) => x.holdMin).sort((a, b) => a - b);
  const quick = t.filter((x) => x.holdMin < 30).length;
  let reentry = 0;
  for (let i = 1; i < t.length; i++) {
    if ((t[i].openTime - t[i - 1].closeTime) / 60000 < 60 && Math.abs(t[i].entry - t[i - 1].entry) / t[i - 1].entry < 0.005) reentry++;
  }
  const bigWins = t.filter((x) => x.dir === 'buy' ? (x.exit - x.entry) / x.entry > 0.02 : (x.entry - x.exit) / x.entry > 0.02).length;
  return [
    `${label}: ${t.length} trade (${(t.length / days).toFixed(2)}/hari) | win bersih ${(winNet / t.length * 100).toFixed(1)}% | PF bersih ${negNet > 0 ? (posNet / negNet).toFixed(2) : 'inf'}`,
    `   kotor ${gross.toFixed(2)} | fee ${(-fee).toFixed(2)} | BERSIH ${net.toFixed(2)} | fee/|kotor| ${(fee / t.reduce((s, x) => s + Math.abs(x.gross), 0) * 100).toFixed(1)}%`,
    `   equity $100 -> $${r.equity.toFixed(2)} | maxDD ${r.maxDd.toFixed(1)}% | hold median ${holds[Math.floor(holds.length / 2)].toFixed(0)} mnt | tutup <30mnt ${quick} (${(quick / t.length * 100).toFixed(0)}%) | re-entry dekat ${reentry} | tangkep gerak >2% ${bigWins}`,
  ].join('\n');
}

// Riset varian (1 Okt 2026) -- SEMUA kombinasi yang dicoba dilaporin (bukan cuma yang menang),
// dipecah tahun-1 vs tahun-2 (independen). Varian dianggap "punya harapan" cuma kalau DUA paruh
// sama-sama PF bersih > 1 -- menang di 1 paruh doang = kemungkinan besar kebetulan.
function runVariants(candles) {
  const mid = candles[Math.floor(candles.length / 2)].openTime;
  const variants = [];
  for (const tf of [15, 60]) {
    for (const minWidthPct of [0.2, 0.3]) {
      for (const confirm of [false, true]) {
        for (const trendSmaLen of [0, 200]) {
          for (const trailMult of [2, 3, 4]) variants.push({ tf, minWidthPct, confirm, trendSmaLen, trailMult });
        }
      }
    }
  }
  console.log(`===== RISET VARIAN (${variants.length} kombinasi, fee 0,05%/sisi, paruh1 vs paruh2) =====`);
  const pfOf = (t) => {
    const pos = t.reduce((s, x) => s + (x.net > 0 ? x.net : 0), 0), neg = -t.reduce((s, x) => s + (x.net < 0 ? x.net : 0), 0);
    return neg > 0 ? pos / neg : (pos > 0 ? Infinity : 0);
  };
  const rows = variants.map((v) => {
    const opts = { minWidthPct: v.minWidthPct, feePctPerSide: 0.05, confirm: v.confirm, trendSmaLen: v.trendSmaLen, trailMult: v.trailMult };
    const h1 = simulate(candles, v.tf, { ...opts, toTime: mid });
    const h2 = simulate(candles, v.tf, { ...opts, fromTime: mid });
    return { v, pf1: pfOf(h1.trades), pf2: pfOf(h2.trades), n1: h1.trades.length, n2: h2.trades.length, eq1: h1.equity, eq2: h2.equity };
  });
  rows.sort((a, b) => Math.min(b.pf1, b.pf2) - Math.min(a.pf1, a.pf2));
  rows.forEach((r) => {
    const v = r.v;
    const tag = r.pf1 > 1 && r.pf2 > 1 ? 'LOLOS 2 paruh' : '';
    console.log(`${v.tf === 60 ? '1H ' : '15M'} lebar>=${v.minWidthPct} konfirmasi=${v.confirm ? 'ya ' : 'tdk'} tren=${v.trendSmaLen ? 'SMA' + v.trendSmaLen : '-     '} trail=${v.trailMult}x | P1 PF ${r.pf1.toFixed(2)} n=${r.n1} $100->$${r.eq1.toFixed(0)} | P2 PF ${r.pf2.toFixed(2)} n=${r.n2} $100->$${r.eq2.toFixed(0)} ${tag}`);
  });
}

async function main() {
  const years = Number(process.argv[2]) || 2;
  const candles = await loadCandles(years);
  if (process.argv[3] === 'variants') { runVariants(candles); return; }
  const days = (candles[candles.length - 1].closeTime - candles[0].openTime) / 86400000;
  console.log(`Data: ${candles.length} candle 5m BTCUSDT, ${new Date(candles[0].openTime).toISOString().slice(0, 10)} -> ${new Date(candles[candles.length - 1].closeTime).toISOString().slice(0, 10)} (${days.toFixed(0)} hari)\n`);

  for (const tf of [5, 15, 60]) {
    console.log(`===== NINJA FVG ${tf === 60 ? '1H' : tf + 'M'} =====`);
    for (const minWidthPct of [0.05, 0.1, 0.2, 0.3]) {
      const r = simulate(candles, tf, { minWidthPct, feePctPerSide: 0.05 });
      console.log(summarize(`filter lebar >=${minWidthPct}% | fee 0,05%/sisi`, r, days));
    }
    const stress = simulate(candles, tf, { minWidthPct: 0.2, feePctPerSide: 0.10 });
    console.log(summarize('STRESS filter >=0.2% | fee 0,10%/sisi', stress, days));
    console.log('');
  }

  // Cek realita: periode live Ninja Channel Breakout (23-30 Sep 2026, demo rugi bersih -$295 dari
  // 42 trade asli di BingX) -- FVG di periode SAMA, biar gak ketipu backtest kayak versi lama.
  const liveStart = Date.UTC(2026, 8, 23, 3, 0);
  const liveEnd = Date.UTC(2026, 8, 30, 2, 0);
  const liveCandles = candles.filter((c) => c.openTime >= liveStart - 10 * 86400000 && c.closeTime <= liveEnd);
  console.log('===== CEK REALITA: periode live Channel Breakout (23-30 Sep 2026) =====');
  for (const tf of [5, 15, 60]) {
    for (const minWidthPct of [0.1, 0.2]) {
      const r = simulate(liveCandles, tf, { minWidthPct, feePctPerSide: 0.05, fromTime: liveStart });
      console.log(summarize(`FVG ${tf === 60 ? '1H' : tf + 'M'} filter >=${minWidthPct}%`, r, 7));
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { detectFvgs, aggregate, simulate };
