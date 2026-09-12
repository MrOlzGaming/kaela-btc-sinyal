// smartMoneyCorrelationReport.js -- 12 Sep 2026, permintaan Olan ("mulai bangun arsip korelasi")
// -- infrastruktur SIAP PAKAI buat ngecek "apa sinyal yang didukung smart-money (gap top-vs-global
// positif) beneran menang lebih sering drpd yang gak didukung", begitu data numpuk cukup.
//
// ⚠️ BELUM ADA GUNANYA sekarang -- field `smartMoneyGapAtEntry` BARU ditambah 12 Sep 2026 ke
// sniper-orders.json + journal Nyopet (Sniper: sniperOrderLog.js+sniperOrders.js, Nyopet:
// nyopetAutoTrader.js). SEMUA order LAMA sebelum tanggal itu otomatis null, gak ikut dihitung.
// Butuh WAKTU (minggu/bulan) sampai jumlah trade CLOSED yang punya field ini cukup banyak buat
// kesimpulan yang bisa dipercaya (MIN_SAMPLE di bawah, sama filosofi kayak MIN_HISTORY di
// anomalyScanner.js -- statistik dari sample kecil GAMPANG ketipu kebetulan).
//
// Cara pakai: `node smartMoneyCorrelationReport.js` kapan aja (read-only, aman dijalanin
// berkali-kali) -- laporan dicetak ke console. BELUM dipanggil otomatis dari run-vultr-executor.sh
// (sengaja -- gak ada gunanya jalan tiap 15 menit selagi datanya masih kosong; jalanin manual pas
// mau dicek, atau tambahin ke dailyAutomationChecklist.js NANTI begitu udah ada cukup data buat
// laporan berkala jadi masuk akal).
//
// ⛔ MURNI RISET -- hasil di sini TIDAK PERNAH otomatis jadi filter/sinyal live. Kalau nanti
// kesimpulannya kuat (breakdown per-tahun/per-strategi konsisten, sample cukup besar), itu WAJIB
// dilaporin+minta izin Olan dulu sebelum dipertimbangkan masuk Fase 2 (filter aktif) -- sama
// disiplin kayak semua riset lain di proyek ini.

const fs = require('fs');
const path = require('path');

const MIN_SAMPLE = 20; // per bucket, sama standar kayak MIN_HISTORY anomalyScanner.js
const GAP_THRESHOLD = 5; // sama ambang kayak smartMoneyContextLine (sniperOrderLog.js/nyopetAutoTrader.js)

// Sumber jurnal yang PUNYA field smartMoneyGapAtEntry (BTC doang, lihat catatan di file asalnya).
// Ditulis eksplisit (bukan glob) -- biar jelas SUMBER MANA yang kehitung, gampang di-audit.
function journalSources() {
  const sources = [
    { label: 'Sniper (shadow global)', file: path.join(__dirname, 'sniper-orders.json'), ordersKey: 'orders' },
    { label: 'Nyopet Demo Olan (standalone)', file: path.join(__dirname, 'nyopet-journal.json'), ordersKey: 'orders' },
    { label: 'Nyopet Real Olan (multi-account)', file: path.join(__dirname, 'multi-account-state', '6281299303888-real-nyopet.json'), ordersKey: 'orders' },
  ];
  return sources.filter((s) => fs.existsSync(s.file));
}

function loadClosedWithGap(source) {
  try {
    const data = JSON.parse(fs.readFileSync(source.file, 'utf8'));
    const orders = data[source.ordersKey] || [];
    return orders.filter((o) =>
      typeof o.status === 'string' && o.status.startsWith('closed') && o.status !== 'closed_untracked'
      && o.smartMoneyGapAtEntry != null && o.pnlUsd != null);
  } catch (e) {
    console.log(`[SmartMoneyCorrelation] Gagal baca ${source.label} (${source.file}):`, e.message);
    return [];
  }
}

function bucketOf(gap) {
  if (gap > GAP_THRESHOLD) return 'DIDUKUNG smart money (gap > +5)';
  if (gap < -GAP_THRESHOLD) return 'DITENTANG smart money (gap < -5)';
  return 'NETRAL (gap -5..+5)';
}

function summarizeBucket(label, rows) {
  if (rows.length === 0) { console.log(`  ${label}: n=0 (belum ada data)`); return; }
  const wins = rows.filter((r) => r.pnlUsd > 0);
  const winRate = (wins.length / rows.length) * 100;
  const avgPnl = rows.reduce((s, r) => s + r.pnlUsd, 0) / rows.length;
  const sumWin = wins.reduce((s, r) => s + r.pnlUsd, 0);
  const sumLoss = Math.abs(rows.filter((r) => r.pnlUsd < 0).reduce((s, r) => s + r.pnlUsd, 0));
  const pf = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : (sumWin > 0 ? 'inf' : '-');
  const flag = rows.length < MIN_SAMPLE ? `  ⚠️ n=${rows.length} < ${MIN_SAMPLE} -- TERLALU KECIL, JANGAN disimpulkan apa-apa dulu` : '';
  console.log(`  ${label}: n=${rows.length} winRate=${winRate.toFixed(1)}% avgPnl=$${avgPnl.toFixed(2)} PF=${pf}${flag}`);
}

function main() {
  const sources = journalSources();
  console.log(`Sumber jurnal ditemukan: ${sources.map((s) => s.label).join(', ') || '(tidak ada)'}\n`);

  const all = [];
  for (const source of sources) {
    const rows = loadClosedWithGap(source);
    console.log(`${source.label}: ${rows.length} trade closed dengan smartMoneyGapAtEntry terisi`);
    all.push(...rows);
  }

  if (all.length === 0) {
    console.log('\nBelum ada trade sama sekali dengan field smartMoneyGapAtEntry -- wajar, fitur ini baru dipasang 12 Sep 2026. Jalankan lagi script ini beberapa minggu/bulan ke depan.');
    return;
  }

  console.log(`\n=== SEMUA STRATEGI GABUNGAN (n=${all.length}) ===`);
  const buckets = { 'DIDUKUNG smart money (gap > +5)': [], 'DITENTANG smart money (gap < -5)': [], 'NETRAL (gap -5..+5)': [] };
  for (const r of all) buckets[bucketOf(r.smartMoneyGapAtEntry)].push(r);
  for (const [label, rows] of Object.entries(buckets)) summarizeBucket(label, rows);

  console.log('\n=== PER SUMBER (konteks, sample lebih kecil) ===');
  for (const source of sources) {
    const rows = loadClosedWithGap(source);
    if (rows.length === 0) continue;
    console.log(`\n-- ${source.label} (n=${rows.length}) --`);
    const b = { 'DIDUKUNG': [], 'DITENTANG': [], 'NETRAL': [] };
    for (const r of rows) {
      const key = r.smartMoneyGapAtEntry > GAP_THRESHOLD ? 'DIDUKUNG' : r.smartMoneyGapAtEntry < -GAP_THRESHOLD ? 'DITENTANG' : 'NETRAL';
      b[key].push(r);
    }
    for (const [label, bRows] of Object.entries(b)) summarizeBucket(label, bRows);
  }

  console.log(`\n⚠️ Ambang MIN_SAMPLE=${MIN_SAMPLE}/bucket -- kalau SEMUA bucket masih di bawah itu, JANGAN ambil kesimpulan apapun dari laporan ini, itu MURNI progress-check, bukan hasil final.`);
}

module.exports = { main, journalSources, loadClosedWithGap, bucketOf };

if (require.main === module) main();
