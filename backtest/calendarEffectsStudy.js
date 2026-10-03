// backtest/calendarEffectsStudy.js (4 Okt 2026, riset malam -- paket "efek kalender" BTC buat kandidat Ninja)
// Biar kalau ditanya "BTC punya hari/jam/tanggal favorit gak?" jawabannya udah ada di katalog. 3 efek:
//   A. HARI DALAM SEMINGGU -- long 24 jam dari 00:00 UTC tiap hari X.
//   B. PERGANTIAN BULAN ("turn of the month", ada di beberapa paper saham & kripto) -- long dari k hari sebelum tgl 1
//      sampai m hari sesudahnya.
//   C. EXPIRY OPSI DERIBIT (Jumat terakhir tiap bulan 08:00 UTC) -- gerak 24 jam sebelum / sesudah expiry.
// RIGOR: aturan DIPILIH di data < 2023 (DEV), lalu DIUJI di >= 2023 (HOLDOUT, gak dipake milih). Biaya 0,12% per trade.
// Null: rata2 return SEMUA jendela dengan panjang sama di periode yang sama (ngilangin bias "BTC naik terus") + z-score.
//
// Pakai: node backtest/calendarEffectsStudy.js <btc-5m.json>
const fs = require('fs');
const FILE = process.argv[2];
if (!FILE) { console.log('Pakai: node backtest/calendarEffectsStudy.js <btc-5m.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const C5 = Array.isArray(raw) ? raw : raw.candles;
const H = 3600e3, DAY = 86400e3, COST = 0.12, SPLIT = Date.UTC(2023, 0, 1);

// harga open per jam (UTC) -- map jamStart -> open
const hourOpen = new Map();
for (const c of C5) { const h = Math.floor(c.openTime / H) * H; if (!hourOpen.has(h)) hourOpen.set(h, c.open); }
const priceAt = (t) => hourOpen.get(t);
const ret = (t0, t1) => { const a = priceAt(t0), b = priceAt(t1); return a && b ? (b - a) / a * 100 : null; };
const t0All = Math.ceil(C5[0].openTime / DAY) * DAY, t1All = Math.floor(C5[C5.length - 1].openTime / DAY) * DAY - 5 * DAY;

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function pfOf(nets) { const w = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0); return l > 0 ? w / l : 99; }
// null: semua jendela panjang `lenH` jam yang mulai jam 00:00 UTC di rentang era
function nullStats(lenH, from, to) {
  const r = [];
  for (let t = Math.max(from, t0All); t < Math.min(to, t1All); t += DAY) { const x = ret(t, t + lenH * H); if (x !== null) r.push(x); }
  return { m: mean(r), s: sd(r) };
}
function evalSet(rets, lenH, from, to) {
  const nl = nullStats(lenH, from, to);
  const nets = rets.map((x) => x - COST);
  const z = rets.length > 1 ? (mean(rets) - nl.m) / (nl.s / Math.sqrt(rets.length)) : 0;
  return { n: rets.length, avg: mean(rets), net: mean(nets), pf: pfOf(nets), z, nullAvg: nl.m };
}
const fmt = (e) => `n${e.n} gross ${e.avg >= 0 ? '+' : ''}${e.avg.toFixed(2)}% (acak ${e.nullAvg >= 0 ? '+' : ''}${e.nullAvg.toFixed(2)}%) net ${e.net >= 0 ? '+' : ''}${e.net.toFixed(2)}% PF ${e.pf.toFixed(2)} z ${e.z.toFixed(1)}`;
const ERAS = [['DEV <2023', 0, SPLIT], ['HOLDOUT >=2023', SPLIT, Infinity]];

// ---------- A. hari dalam seminggu ----------
console.log('== A. HARI DALAM SEMINGGU (long 24 jam dari 00:00 UTC = 08:00 WITA) ==');
const DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const dowRes = {};
for (let d = 0; d < 7; d++) {
  const line = [];
  for (const [name, from, to] of ERAS) {
    const rets = [];
    for (let t = Math.max(from, t0All); t < Math.min(to, t1All); t += DAY) if (new Date(t).getUTCDay() === d) { const x = ret(t, t + 24 * H); if (x !== null) rets.push(x); }
    const e = evalSet(rets, 24, from, to); dowRes[`${d}-${name}`] = e;
    line.push(`${name}: ${fmt(e)}`);
  }
  console.log(`  ${DOW[d].padEnd(6)} | ${line.join(' | ')}`);
}
const devBestDow = [...Array(7).keys()].sort((a, b) => dowRes[`${b}-DEV <2023`].avg - dowRes[`${a}-DEV <2023`].avg)[0];
const devWorstDow = [...Array(7).keys()].sort((a, b) => dowRes[`${a}-DEV <2023`].avg - dowRes[`${b}-DEV <2023`].avg)[0];
console.log(`  -> Hari TERBAIK di DEV: ${DOW[devBestDow]}; di HOLDOUT: ${fmt(dowRes[`${devBestDow}-HOLDOUT >=2023`])}`);
console.log(`  -> Hari TERBURUK di DEV: ${DOW[devWorstDow]}; di HOLDOUT: ${fmt(dowRes[`${devWorstDow}-HOLDOUT >=2023`])}`);

// ---------- B. pergantian bulan ----------
console.log('\n== B. PERGANTIAN BULAN (long dari k hari sebelum tgl 1 s/d m hari sesudah, 00:00 UTC) ==');
const tomRes = [];
for (const k of [0, 1, 2, 3]) for (const m of [1, 2, 3, 4, 5]) {
  const lenH = (k + m) * 24;
  const row = { k, m };
  for (const [name, from, to] of ERAS) {
    const rets = [];
    for (let y = 2019; y <= 2026; y++) for (let mo = 0; mo < 12; mo++) {
      const first = Date.UTC(y, mo, 1), t = first - k * DAY;
      if (t < Math.max(from, t0All) || t >= Math.min(to, t1All)) continue;
      const x = ret(t, t + lenH * H); if (x !== null) rets.push(x);
    }
    row[name] = evalSet(rets, lenH, from, to);
  }
  tomRes.push(row);
}
tomRes.sort((a, b) => b['DEV <2023'].z - a['DEV <2023'].z);
for (const r of tomRes.slice(0, 6)) console.log(`  k${r.k} m${r.m} | DEV ${fmt(r['DEV <2023'])} | HOLDOUT ${fmt(r['HOLDOUT >=2023'])}`);
const tomBest = tomRes[0];
const tomPosHold = tomRes.filter((r) => r['HOLDOUT >=2023'].z > 0).length;
console.log(`  -> Pilihan DEV (k${tomBest.k} m${tomBest.m}) di HOLDOUT: z ${tomBest['HOLDOUT >=2023'].z.toFixed(1)}, net ${tomBest['HOLDOUT >=2023'].net.toFixed(2)}%/trade. Semua 20 varian: z HOLDOUT > 0 di ${tomPosHold}/20.`);

// ---------- C. expiry opsi Deribit ----------
console.log('\n== C. EXPIRY OPSI BULANAN DERIBIT (Jumat terakhir 08:00 UTC = 16:00 WITA) ==');
function lastFriday(y, mo) { const d = new Date(Date.UTC(y, mo + 1, 0)); while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1); return d.getTime() + 8 * H; }
const absMove = (t0, t1) => { const x = ret(t0, t1); return x === null ? null : Math.abs(x); };
for (const [name, from, to] of ERAS) {
  const pre = [], post = [], preAbs = [], postAbs = [], otherPreAbs = [], otherPostAbs = [];
  for (let y = 2019; y <= 2026; y++) for (let mo = 0; mo < 12; mo++) {
    const t = lastFriday(y, mo);
    if (t - DAY < Math.max(from, t0All) || t + DAY >= Math.min(to, t1All)) continue;
    const a = ret(t - DAY, t), b = ret(t, t + DAY);
    if (a !== null) { pre.push(a); preAbs.push(Math.abs(a)); }
    if (b !== null) { post.push(b); postAbs.push(Math.abs(b)); }
  }
  // Jumat lain (bukan expiry bulanan) jam yang sama -- pembanding volatilitas
  for (let t = Math.max(from, t0All) + 8 * H; t < Math.min(to, t1All); t += DAY) {
    const d = new Date(t); if (d.getUTCDay() !== 5) continue;
    if (t === lastFriday(d.getUTCFullYear(), d.getUTCMonth())) continue;
    const a = absMove(t - DAY, t), b = absMove(t, t + DAY); if (a !== null) otherPreAbs.push(a); if (b !== null) otherPostAbs.push(b);
  }
  console.log(`  ${name}: 24j SEBELUM expiry rata2 ${mean(pre).toFixed(2)}% (|gerak| ${mean(preAbs).toFixed(2)}% vs Jumat biasa ${mean(otherPreAbs).toFixed(2)}%), n${pre.length} | 24j SESUDAH ${mean(post).toFixed(2)}% (|gerak| ${mean(postAbs).toFixed(2)}% vs ${mean(otherPostAbs).toFixed(2)}%)`);
}

// ---------- A2. DALAMI hari dalam seminggu: Senin+Rabu long (pilihan DEV top-2) ----------
// (1) geser jam mulai -- efek "hari" yang asli harus tahan digeser beberapa jam; (2) per tahun; (3) semua 21 pasangan hari:
// seberapa unik Senin+Rabu di HOLDOUT; (4) gabung short Kamis (BTC boleh short, exposure /2).
console.log('\n== A2. Senin+Rabu LONG 24 jam -- ketahanan ==');
function dowRets(days, startHourUtc, from, to, holdH = 24) {
  const out = [];
  for (let t = Math.max(from, t0All); t < Math.min(to, t1All); t += DAY) {
    const ts = t + startHourUtc * H;
    if (!days.includes(new Date(ts).getUTCDay())) continue;
    const x = ret(ts, ts + holdH * H); if (x !== null) out.push({ t: ts, x });
  }
  return out;
}
for (const sh of [-8, -4, 0, 4, 8, 12]) {
  const parts = ERAS.map(([name, from, to]) => `${name}: ${fmt(evalSet(dowRets([1, 3], sh, from, to).map((r) => r.x), 24, from, to))}`);
  console.log(`  mulai ${String(sh).padStart(3)}j UTC (${String((sh + 8 + 24) % 24).padStart(2, '0')}:00 WITA) | ${parts.join(' | ')}`);
}
console.log('  Per tahun (mulai 00:00 UTC):');
const allMW = dowRets([1, 3], 0, 0, Infinity);
for (let y = 2019; y <= 2026; y++) {
  const yr = allMW.filter((r) => new Date(r.t).getUTCFullYear() === y).map((r) => r.x);
  const from = Date.UTC(y, 0, 1), to = Date.UTC(y + 1, 0, 1);
  if (yr.length > 5) console.log(`    ${y}: ${fmt(evalSet(yr, 24, from, to))}`);
}
// semua pasangan hari di HOLDOUT
const pairs = [];
for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
  const r = dowRets([a, b], 0, SPLIT, Infinity).map((x) => x.x);
  pairs.push({ a, b, e: evalSet(r, 24, SPLIT, Infinity) });
}
pairs.sort((x, y) => y.e.z - x.e.z);
const rank = pairs.findIndex((p) => p.a === 1 && p.b === 3) + 1;
console.log(`  HOLDOUT: Senin+Rabu peringkat ${rank}/21 dari semua pasangan hari (z ${pairs[rank - 1].e.z.toFixed(1)}). Top 3: ${pairs.slice(0, 3).map((p) => `${DOW[p.a]}+${DOW[p.b]} z${p.e.z.toFixed(1)}`).join(', ')}`);
// korelasi efek harian DEV vs HOLDOUT
const ex = (name) => [...Array(7).keys()].map((d) => dowRes[`${d}-${name}`].avg - dowRes[`${d}-${name}`].nullAvg);
const dv = ex('DEV <2023'), ho = ex('HOLDOUT >=2023');
const corr = (() => { const ma = mean(dv), mb = mean(ho); let s = 0, sa = 0, sb = 0; for (let i = 0; i < 7; i++) { s += (dv[i] - ma) * (ho[i] - mb); sa += (dv[i] - ma) ** 2; sb += (ho[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); })();
console.log(`  Korelasi efek per hari DEV vs HOLDOUT: ${corr.toFixed(2)} (7 titik -- butuh > ~0,75 buat p < 0,05 satu sisi)`);
// gabung: long Senin+Rabu, short Kamis (exposure /2)
for (const [name, from, to] of ERAS) {
  const L = dowRets([1, 3], 0, from, to).map((r) => r.x - COST);
  const S = dowRets([4], 0, from, to).map((r) => (-r.x - COST) / 2);
  const all = [...L, ...S];
  console.log(`  ${name}: long Sen+Rab net ${mean(L).toFixed(2)}%/trade (n${L.length}) + short Kamis (/2) net ${mean(S).toFixed(2)}%/trade (n${S.length}) -> total ${all.reduce((a, b) => a + b, 0).toFixed(1)}% notional, PF ${pfOf(all).toFixed(2)}`);
}

// ---------- A3. DI JAM BERAPA untungnya numpuk? (return per jam UTC, Senin+Rabu vs hari lain, per era) ----------
console.log('\n== A3. Return rata2 per JAM (UTC), basis poin (0,01%) -- Sen+Rab vs hari lain ==');
for (const [name, from, to] of ERAS) {
  const mw = Array(24).fill(0).map(() => []), oth = Array(24).fill(0).map(() => []);
  for (let t = Math.max(from, t0All); t < Math.min(to, t1All); t += H) {
    const x = ret(t, t + H); if (x === null) continue;
    const d = new Date(t); (([1, 3].includes(d.getUTCDay())) ? mw : oth)[d.getUTCHours()].push(x * 100);
  }
  console.log(`  ${name}`);
  console.log('    jam UTC : ' + [...Array(24).keys()].map((h) => String(h).padStart(4)).join(''));
  console.log('    Sen+Rab : ' + mw.map((a) => String(Math.round(mean(a))).padStart(4)).join(''));
  console.log('    lainnya : ' + oth.map((a) => String(Math.round(mean(a))).padStart(4)).join(''));
}

// ---------- A4. Senin+Rabu long 24 jam + SL darurat (cek per candle 5m) -- buat kalkulator exposure ----------
console.log('\n== A4. Senin+Rabu long 00:00 UTC (08:00 WITA) 24 jam + SL darurat ==');
const idx5 = new Map(C5.map((c, i) => [c.openTime, i]));
function tradeSl(ts, slPct) {
  const i0 = idx5.get(ts); if (i0 === undefined) return null;
  const entry = C5[i0].open, slP = entry * (1 - slPct / 100), end = ts + 24 * H;
  let i = i0;
  for (; i < C5.length && C5[i].openTime < end; i++) if (slPct && C5[i].low <= slP) return { x: -slPct, sl: true };
  return { x: (C5[i - 1].close - entry) / entry * 100, sl: false };
}
for (const slPct of [0, 2, 3, 4, 6]) {
  const parts = [];
  for (const [name, from, to] of ERAS) {
    const rows = [];
    for (let t = Math.max(from, t0All); t < Math.min(to, t1All); t += DAY) if ([1, 3].includes(new Date(t).getUTCDay())) { const r = tradeSl(t, slPct); if (r) rows.push(r); }
    const nets = rows.map((r) => r.x - COST);
    let eq = 0, peak = 0, dd = 0; for (const n of nets) { eq += n; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
    parts.push(`${name}: n${nets.length} net ${mean(nets).toFixed(2)}%/trade PF ${pfOf(nets).toFixed(2)} kena SL ${rows.filter((r) => r.sl).length} | total ${eq.toFixed(0)}% DD ${dd.toFixed(0)}% (notional 1x)`);
  }
  console.log(`  SL ${slPct || '-'}% | ${parts.join(' | ')}`);
}
