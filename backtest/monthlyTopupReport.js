// Laporan backtest 4 SLOT + 2 POOL REDIRECT, skema top-up bulanan (31 Agu 2026, permintaan Olan):
//
// 1. "tiap bulan isi terus 50 dolar" per slot (Sniper BTC / Sniper Emas / Nyopet BTC / Nyopet
//    Emas), mulai modal $50, top-up tanggal 5 tiap bulan SELAMA saldo AKTUAL (bukan cuma total
//    setoran) masih di bawah $1.000 -- trading jalan BARENGAN sejak modal pertama, gak nunggu
//    penuh dulu. Begitu saldo nyentuh/lewat $1.000, top-up ke slot itu berhenti.
// 2. "kalo dah ga top up isinya ke btc spot terus dan emas terus" -- begitu SATU slot capped,
//    $50/bulan yang HARUSNYA masuk situ dialihin ke pool spot aset yang sama (Sniper BTC/Nyopet
//    BTC capped -> pool Spot BTC, Sniper Emas/Nyopet Emas capped -> pool Spot Emas).
// 3. "spot selalu jual di window peak dan compound di window buy.. ngikut btc" -- pool spot BUKAN
//    buy-and-hold biasa, ngikutin mekanisme Compound Alt DCA yang UDAH ADA (spotDcaAltShared.js):
//    beli SELAMA window Musim Tanam BTC (halving-542 hari s/d hari-H), TAHAN pas halving lewat,
//    jual SEMUA di hari puncak historis (halving+536 hari), hasil jual + setoran baru compound
//    balik ke siklus Tanam berikutnya. Dipakai buat KEDUA pool (BTC dan Emas) -- window Tanam/
//    Panen-nya SAMA (kalender halving BTC), cuma harga acuan beli/jual beda per aset.
//
// Cara jalanin cepat kapan aja: `node backtest/monthlyTopupReport.js` dari root proyek.
// Hasil disimpan ke backtest/monthlyTopupReport-result.json (snapshot angka terakhir).

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { runCrossAssetBacktest, summarize: summarizeSniper } = require(path.join(ROOT, 'backtestCrossAsset.js'));
const { runNyopetV2Backtest, summarize: summarizeNyopet, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H } = require('./nyopetChartPatternFvg.js');

const TOPUP = { startCapital: 50, topUpAmount: 50, topUpStopAt: 1000, topUpDayOfMonth: 5 };

// ============ Pool redirect: siklus Tanam/Panen BTC (reuse konstanta spotDcaAltShared.js) ============
const DAY_MS = 86400000;
const TANAM_START_OFFSET_DAYS = 542; // WINDOW_START vs HALVING_DATE siklus depan (2026-10-19 -> 2028-04-13)
const PEAK_SELL_DAYS_AFTER_HALVING = 536; // rata2 historis 3 siklus (_findpeaks.js: 526/547/536)
const HALVING_DATES = ['2016-07-09', '2020-05-11', '2024-04-19', '2028-04-13'].map((d) => new Date(d).getTime());

function buildCycles() {
  return HALVING_DATES.map((h) => ({
    tanamStart: h - TANAM_START_OFFSET_DAYS * DAY_MS,
    halving: h,
    harvest: h + PEAK_SELL_DAYS_AFTER_HALVING * DAY_MS,
  }));
}

function priceAt(daily, ms) {
  let lo = 0, hi = daily.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (daily[mid].closeTime <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return daily[ans].close;
}

// Simulasi 1 pool redirect: terima injeksi cash di tanggal2 tertentu (dari slot yg capped),
// beli SELAMA window Tanam (lump-sum begitu cash tersedia di window itu), tahan pas halving,
// jual SEMUA di hari puncak, proceeds jadi modal siklus Tanam berikutnya.
function simulateRedirectSpot(redirectEvents, daily) {
  const cycles = buildCycles();
  const byDay = {};
  for (const ev of redirectEvents) {
    const dayKey = Math.floor(ev.dateMs / DAY_MS);
    byDay[dayKey] = (byDay[dayKey] || 0) + ev.amount;
  }
  let pendingCash = 0, heldQty = 0, totalDeposited = 0, cycleIdx = 0;
  const log = [];
  const startMs = daily[0].closeTime, endMs = daily[daily.length - 1].closeTime;

  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const dayKey = Math.floor(ms / DAY_MS);
    if (byDay[dayKey]) { pendingCash += byDay[dayKey]; totalDeposited += byDay[dayKey]; }

    // Lewatin siklus yang harvest-nya udah kelewat (jual kalau lagi holding, atau skip kalau kosong)
    while (cycleIdx < cycles.length && ms >= cycles[cycleIdx].harvest) {
      if (heldQty > 0) {
        const price = priceAt(daily, cycles[cycleIdx].harvest);
        const proceeds = heldQty * price;
        pendingCash += proceeds;
        log.push({ event: 'JUAL', date: new Date(cycles[cycleIdx].harvest).toISOString().slice(0, 10), price: +price.toFixed(2), proceeds: +proceeds.toFixed(2) });
        heldQty = 0;
      }
      cycleIdx++;
    }

    const cyc = cycles[cycleIdx];
    if (!cyc) continue; // udah lewat semua siklus yang diketahui
    const inTanam = ms >= cyc.tanamStart && ms < cyc.halving;
    if (inTanam && pendingCash > 0.01) {
      const price = priceAt(daily, ms);
      const qty = pendingCash / price;
      heldQty += qty;
      log.push({ event: 'BELI', date: new Date(ms).toISOString().slice(0, 10), price: +price.toFixed(2), amount: +pendingCash.toFixed(2) });
      pendingCash = 0;
    }
  }

  const lastPrice = daily[daily.length - 1].close;
  const finalValue = pendingCash + heldQty * lastPrice;
  return { totalDeposited, finalValue, pendingCash: +pendingCash.toFixed(2), heldQty, lastPrice, log };
}

function byYearSniper(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { n: 0, wins: 0 };
    years[y].n++;
    if (t.pnlUsd > 0) years[y].wins++;
  });
  return years;
}
function byYearNyopet(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { n: 0, wins: 0 };
    years[y].n++;
    if (t.rMultiple > 0) years[y].wins++;
  });
  return years;
}
function yearsSpan(startMs, endMs) { return (endMs - startMs) / (365.25 * DAY_MS); }
function dateOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

function printSlot(label, r, s, candles, byYearFn) {
  const startMs = candles[0].closeTime, endMs = candles[candles.length - 1].closeTime;
  const span = yearsSpan(startMs, endMs);
  console.log(`\n=== ${label} ===`);
  console.log(`Rentang data: ${dateOf(startMs)} -> ${dateOf(endMs)} (~${span.toFixed(2)} tahun)`);
  console.log(`Total sinyal: ${s.n} | Win rate: ${s.winRate} | PF: ${s.profitFactor}`);
  console.log(`Rata-rata sinyal/tahun: ${(s.n / span).toFixed(1)}`);
  console.log(`Total setoran ke slot ini: $${r.totalDeposited.toFixed(0)} | Saldo akhir: $${r.finalCapital.toFixed(2)} | Max Drawdown: ${r.maxDrawdownPct.toFixed(1)}%`);
  const py = byYearFn(r.trades);
  console.log('Breakdown per tahun:');
  Object.keys(py).sort().forEach((y) => {
    const d = py[y];
    console.log(`  ${y}: ${d.n} trade | win rate ${(d.wins / d.n * 100).toFixed(1)}%`);
  });
  return { label, ...s, totalDeposited: r.totalDeposited, finalCapital: r.finalCapital, maxDrawdownPct: r.maxDrawdownPct, rentang: `${dateOf(startMs)} -> ${dateOf(endMs)}`, tahunData: +span.toFixed(2), sinyalPerTahun: +(s.n / span).toFixed(1), perTahun: py };
}

console.log('=== Laporan Top-Up Bulanan $50/bulan (cap saldo $1.000/slot) + Redirect ke Spot BTC/Emas ===');

const btcDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'daily-cache.json'), 'utf8'));
const goldDaily = JSON.parse(fs.readFileSync(path.join(ROOT, 'backtest', 'gold-daily-cache.json'), 'utf8'));

const btcRedirects = [];
const goldRedirects = [];
const results = [];

// 1. Sniper BTC (solo, halt window istirahat halving -- config live)
{
  const r = runCrossAssetBacktest({ btc: btcDaily }, { ...TOPUP, haltBtcInBearWindow: true, onRedirectedTopUp: (amt, ms) => btcRedirects.push({ dateMs: ms, amount: amt }) });
  const s = summarizeSniper(r.trades);
  results.push(printSlot('1. SNIPER BTC (harian)', r, s, btcDaily, byYearSniper));
}

// 2. Sniper Emas (solo, TANPA halt -- config live)
{
  const r = runCrossAssetBacktest({ gold: goldDaily }, { ...TOPUP, haltBtcInBearWindow: false, onRedirectedTopUp: (amt, ms) => goldRedirects.push({ dateMs: ms, amount: amt }) });
  const s = summarizeSniper(r.trades);
  results.push(printSlot('2. SNIPER EMAS (harian, data GC=F 25th)', r, s, goldDaily, byYearSniper));
}

// 3. Nyopet BTC (4H, long-only, modal/5 -- config live)
{
  const r = runNyopetV2Backtest(CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, ...TOPUP, onRedirectedTopUp: (amt, ms) => btcRedirects.push({ dateMs: ms, amount: amt }) });
  const s = summarizeNyopet(r.trades);
  results.push(printSlot('3. NYOPET BTC (4H)', r, s, CANDLES_4H, byYearNyopet));
}

// 4. Nyopet Emas (4H, long-only, modal/5 -- config live)
if (CANDLES_4H_GOLD) {
  const r = runNyopetV2Backtest(CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, ...TOPUP, onRedirectedTopUp: (amt, ms) => goldRedirects.push({ dateMs: ms, amount: amt }) });
  const s = summarizeNyopet(r.trades);
  results.push(printSlot('4. NYOPET EMAS (4H, PAXGUSDT)', r, s, CANDLES_4H_GOLD, byYearNyopet));
}

console.log('\n=== RINGKASAN 4 SLOT TRADING ===');
let totalDeposit = 0, totalFinal = 0;
for (const res of results) {
  console.log(`${res.label.padEnd(35)} | setor $${res.totalDeposited.toFixed(0)} -> $${res.finalCapital.toFixed(2)} | WR ${res.winRate} | PF ${res.profitFactor} | DD ${res.maxDrawdownPct.toFixed(1)}%`);
  totalDeposit += res.totalDeposited; totalFinal += res.finalCapital;
}
console.log(`Subtotal 4 slot: setor $${totalDeposit.toFixed(0)} -> $${totalFinal.toFixed(2)}`);

console.log('\n=== POOL REDIRECT: SPOT BTC (ngikut window Tanam-Panen halving) ===');
const spotBtc = simulateRedirectSpot(btcRedirects, btcDaily);
console.log(`Jumlah setoran redirect masuk: ${btcRedirects.length}x ($50 tiap kali) = $${spotBtc.totalDeposited.toFixed(0)}`);
console.log(`Nilai akhir: $${spotBtc.finalValue.toFixed(2)} (held ${spotBtc.heldQty.toFixed(6)} BTC @ $${spotBtc.lastPrice.toFixed(0)} + cash nganggur $${spotBtc.pendingCash.toFixed(2)})`);
console.log('Log siklus beli/jual:');
spotBtc.log.forEach((l) => console.log(`  ${l.date} ${l.event} ${l.event === 'BELI' ? `$${l.amount} @ $${l.price}` : `@ $${l.price} -> proceeds $${l.proceeds}`}`));

console.log('\n=== POOL REDIRECT: SPOT EMAS (ngikut window Tanam-Panen halving BTC) ===');
const spotGold = simulateRedirectSpot(goldRedirects, goldDaily);
console.log(`Jumlah setoran redirect masuk: ${goldRedirects.length}x ($50 tiap kali) = $${spotGold.totalDeposited.toFixed(0)}`);
console.log(`Nilai akhir: $${spotGold.finalValue.toFixed(2)} (held ${spotGold.heldQty.toFixed(4)} unit @ $${spotGold.lastPrice.toFixed(0)} + cash nganggur $${spotGold.pendingCash.toFixed(2)})`);
console.log('Log siklus beli/jual:');
spotGold.log.forEach((l) => console.log(`  ${l.date} ${l.event} ${l.event === 'BELI' ? `$${l.amount} @ $${l.price}` : `@ $${l.price} -> proceeds $${l.proceeds}`}`));

const grandDeposit = totalDeposit + spotBtc.totalDeposited + spotGold.totalDeposited;
const grandFinal = totalFinal + spotBtc.finalValue + spotGold.finalValue;
console.log('\n=== GRAND TOTAL (4 slot trading + 2 pool spot redirect) ===');
console.log(`Total setoran ke 4 slot (sebelum capped): $${totalDeposit.toFixed(0)}`);
console.log(`Total setoran yang dialihin ke pool redirect (setelah slot asal capped): $${(spotBtc.totalDeposited + spotGold.totalDeposited).toFixed(0)} (BTC $${spotBtc.totalDeposited.toFixed(0)} + Emas $${spotGold.totalDeposited.toFixed(0)})`);
console.log(`Total setoran keseluruhan (uang beneran keluar dari kantong Olan, $50/bulan/slot terus-menerus): $${grandDeposit.toFixed(0)}`);
console.log(`Nilai akhir keseluruhan: $${grandFinal.toFixed(2)} (${((grandFinal / grandDeposit - 1) * 100).toFixed(0)}% dari total setoran)`);

const output = {
  generatedAt: new Date().toISOString(),
  topUpScheme: TOPUP,
  redirectScheme: { note: 'begitu slot capped, $50/bulan dialihin ke pool spot aset yg sama, ikut window Tanam-Panen halving BTC', tanamStartOffsetDays: TANAM_START_OFFSET_DAYS, peakSellDaysAfterHalving: PEAK_SELL_DAYS_AFTER_HALVING },
  slots: results,
  spotBtcRedirect: spotBtc,
  spotGoldRedirect: spotGold,
  totalDepositAllSlots: totalDeposit,
  totalFinalTradingSlots: totalFinal,
  grandTotalDeposit: grandDeposit,
  grandTotalFinal: grandFinal,
};
fs.writeFileSync(path.join(__dirname, 'monthlyTopupReport-result.json'), JSON.stringify(output, null, 2));
console.log('\nSnapshot disimpan ke backtest/monthlyTopupReport-result.json');
