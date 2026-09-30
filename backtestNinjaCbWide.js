// backtestNinjaCbWide.js (30 Sep 2026) -- Olan: "Channel breakout bagus tapi kurang cerdas.. di tekan
// dikit dah kabur." Uji adil: sinyal Channel Breakout PERSIS sama (chartPatterns.detectChannel,
// level top/bottom +/- halfWidth), tapi (1) entry REALISTIS di OPEN candle setelah candle breakout
// close (bukan di level teoretis -- sumber PF palsu backtest lama, lihat BACKTEST-REGISTRY.md) dan
// (2) jarak SL/trailing DILEBARIN: kelipatan lebar channel (1x = versi live lama, 2x/4x/8x) atau
// k x ATR14 -- biar gak "kabur" pas ditekan dikit. Plus cooldown: abis exit, channel baru baru boleh
// dicari setelah `cooldown` candle (ngurangin re-entry beruntun).
// Diuji 5M/15M/1H, in-sample (2 thn terakhir) DAN out-of-sample (Sep 2019 - Sep 2024).
// Pakai: NINJA_CANDLE_CACHE=/dir node backtestNinjaCbWide.js
const fs = require('fs');
const path = require('path');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { summarize } = require('./backtestNinjaFvg');
const { atrSeries } = require('./backtestNinjaCandidates');

async function fetchSym(interval, startTime, endTime) {
  const dir = process.env.NINJA_CANDLE_CACHE;
  const file = dir ? path.join(dir, `BTCUSDT-${interval}-${startTime}-${endTime}-v.json`) : null;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let all = [], cur = startTime;
  while (cur < endTime) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${cur}&endTime=${endTime}&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const d = await r.json();
    if (!d.length) break;
    all = all.concat(d.map((x) => ({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], closeTime: x[6] })));
    cur = d[d.length - 1][0] + 1;
  }
  all = all.filter((c) => c.closeTime < endTime);
  if (file) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); }
  return all;
}

// mode 'hw' -> jarak = mult x halfWidth ; mode 'atr' -> jarak = mult x ATR14
function run(c, { mode, mult, cooldown }) {
  const atr = atrSeries(c);
  const trades = [];
  let i = 45, active = null, foundAt = 0;
  while (i < c.length - 1) {
    if (!active) { const ch = detectChannel(c, i, { maxWidthAtrMultiple: 1.5 }); if (ch) { active = ch; foundAt = i; } i++; continue; }
    if (i - foundAt > 100) { active = null; continue; }
    const { top, bottom } = channelLinesAt(active, i);
    const hw = (top - bottom) / 2;
    if (hw <= 0) { active = null; continue; }
    const x = c[i];
    let dir = null;
    if (x.close >= top + hw) dir = 'long'; else if (x.close <= bottom - hw) dir = 'short'; // breakout dikonfirmasi CLOSE
    if (!dir || atr[i] === null) { i++; continue; }
    const e = c[i + 1].open; // entry realistis
    const dist = mode === 'hw' ? mult * hw : mult * atr[i];
    const f = dist / e;
    let sl = dir === 'long' ? e * (1 - f) : e * (1 + f), extreme = e, exitIdx = null, exitPrice = null;
    for (let j = i + 1; j < c.length; j++) {
      const y = c[j];
      if (dir === 'long' ? y.low <= sl : y.high >= sl) { exitIdx = j; exitPrice = dir === 'long' ? Math.min(y.open, sl) : Math.max(y.open, sl); break; }
      if (dir === 'long' && y.high > extreme) { extreme = y.high; sl = Math.max(sl, extreme * (1 - f)); }
      if (dir === 'short' && y.low < extreme) { extreme = y.low; sl = Math.min(sl, extreme * (1 + f)); }
    }
    if (exitIdx === null) break;
    trades.push({ dir, entryPrice: e, entryIdx: i + 1, exitIdx, exitPrice, slDistPct: f * 100, grossPct: ((exitPrice - e) / e) * 100 * (dir === 'long' ? 1 : -1) });
    active = null;
    i = exitIdx + 1 + cooldown;
  }
  return trades;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));
const TF = { '5m': 5, '15m': 15, '1h': 60 };

async function main() {
  const now = Date.now(), split = Date.UTC(2024, 8, 30), start = Date.UTC(2019, 8, 30);
  const variants = [];
  for (const mult of [1, 2, 4, 8]) variants.push({ mode: 'hw', mult });
  for (const mult of [2, 3, 4]) variants.push({ mode: 'atr', mult });
  let posIs = 0, posOos = 0, total = 0;
  for (const tf of Object.keys(TF)) {
    const isC = await fetchSym(tf, now - 730 * 864e5, now);
    const oosC = await fetchSym(tf, start, split);
    console.log(`\n=== ${tf.toUpperCase()} -- fee 0.10% RT, entry di open candle setelah breakout close ===`);
    for (const v of variants) for (const cooldown of [0, tf === '1h' ? 6 : 12]) {
      const p = { ...v, cooldown };
      const out = [];
      for (const [nm, c, days] of [['IS 2024-26', isC, 730], ['OOS 2019-24', oosC, (split - start) / 864e5]]) {
        const tr = run(c, p);
        if (tr.length < 20) { out.push(`${nm}: n=${tr.length}`); continue; }
        const s = summarize(tr, TF[tf], days, 0.10);
        if (nm.startsWith('IS') && s.netSumPct > 0) posIs++;
        if (nm.startsWith('OOS') && s.netSumPct > 0) posOos++;
        out.push(`${nm}: n=${s.n} win=${f2(s.winNet, 1)}% PFg=${f2(s.pfGross)} PFnet=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% hold=${f2(s.medianHoldMin, 0)}m cepat=${f2(s.quickClosePct, 0)}%`);
      }
      total++;
      console.log(`${tf} ${p.mode}x${p.mult} cd${cooldown}`.padEnd(18) + out.join(' || '));
    }
  }
  console.log(`\n-> net positif: in-sample ${posIs}/${total}, out-of-sample ${posOos}/${total}`);
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });
module.exports = { run };
