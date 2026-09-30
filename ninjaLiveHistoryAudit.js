// ninjaLiveHistoryAudit.js (30 Sep 2026) -- audit histori transaksi NINJA LIVE (demo+real) dari
// snapshot channel-breakout-journal.json yang di-commit otomatis tiap ~15 menit oleh Vultr.
// Permintaan Olan: "BUKTIKAN ATAU BANTAH DENGAN HISTORI TRANSAKSI NINJA, jangan pakai asumsi."
//
// Journal cuma nyimpen posisi floating + statistik kumulatif (bukan daftar trade), jadi audit ini
// rekonstruksi dari SELISIH antar-snapshot: closedCount/wins/losses/totalPnlUsd (NET, fee 0,10%/
// sisi sejak 26 Sep 2026) + dailySignalSeq (jumlah entry per hari). Trade yang buka-tutup di antara
// 2 snapshot tetap ketangkep di hitungan, cuma detail harganya yang gak kerekam.
//
// Read-only. Pakai: node ninjaLiveHistoryAudit.js [ref=origin/master] [sejak=2026-09-27T07:40:00Z]

const { execFileSync } = require('child_process');

const REF = process.argv[2] || 'origin/master';
const SINCE = process.argv[3] || '2026-09-27T07:40:00Z'; // snapshot pertama yg PnL-nya udah net-of-fee semua
const FILE = 'channel-breakout-journal.json';
const FEE_PER_SIDE = 0.001; // yang DIPAKAI live saat histori ini terbentuk (0,10%/sisi, dobel -- BUG-0046, fix 30 Sep 2026); tetap 0,10% di sini biar rekonstruksi gross dari net journal tetap benar

function git(args) { return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }

function main() {
  const commits = git(['log', '--reverse', '--format=%H %cI', REF, '--', FILE]).trim().split('\n').map((l) => l.split(' '));
  const snaps = [];
  for (const [sha, date] of commits) {
    try {
      const j = JSON.parse(git(['show', `${sha}:${FILE}`])).trailing;
      if (j) snaps.push({ date, j });
    } catch { /* snapshot rusak/beda format -- lewati */ }
  }
  const inRange = snaps.filter((s) => new Date(s.date) >= new Date(SINCE));
  if (inRange.length < 2) { console.log('Snapshot kurang buat dianalisis.'); return; }
  const first = inRange[0].j, last = inRange[inRange.length - 1].j;

  const trades = last.closedCount - first.closedCount;
  const wins = last.stats.demo.wins - first.stats.demo.wins;
  const losses = last.stats.demo.losses - first.stats.demo.losses;
  const netUsd = last.stats.demo.totalPnlUsd - first.stats.demo.totalPnlUsd;
  const spanDays = (new Date(inRange[inRange.length - 1].date) - new Date(inRange[0].date)) / 864e5;

  // Entry per hari dari dailySignalSeq (nilai terakhir tiap dayKey).
  const perDay = {};
  for (const s of inRange) { const d = s.j.dailySignalSeq; if (d && d.dayKey) perDay[d.dayKey] = Math.max(perDay[d.dayKey] || 0, d.count); }

  // Kluster: >=2 trade ketutup di antara 2 snapshot berurutan (~15 menit) = buka-tutup beruntun.
  let clusterSnaps = 0, clusterTrades = 0, maxBurst = 0;
  for (let k = 1; k < inRange.length; k++) {
    const d = inRange[k].j.closedCount - inRange[k - 1].j.closedCount;
    maxBurst = Math.max(maxBurst, d);
    if (d >= 2) { clusterSnaps++; clusterTrades += d; }
  }

  // Ukuran posisi dari floating yang kerekam -> estimasi fee round-trip per trade.
  const notionals = [];
  const seen = new Set();
  for (const s of inRange) {
    const f = s.j.floating;
    if (f && f.demo && !seen.has(f.id)) { seen.add(f.id); notionals.push(f.demo.entryPrice * f.demo.quantity); }
  }
  const avgNotional = notionals.reduce((a, b) => a + b, 0) / Math.max(1, notionals.length);
  const estFee = trades * avgNotional * FEE_PER_SIDE * 2;
  const estGross = netUsd + estFee;

  console.log(`=== AUDIT NINJA LIVE (demo) ${inRange[0].date} s/d ${inRange[inRange.length - 1].date} (${spanDays.toFixed(1)} hari, ${inRange.length} snapshot) ===`);
  console.log(`Trade ditutup : ${trades} (${(trades / spanDays).toFixed(1)}/hari) -- menang ${wins}, kalah ${losses} (win ${(wins / Math.max(1, trades) * 100).toFixed(1)}%)`);
  console.log(`Entry per hari: ${Object.entries(perDay).map(([d, c]) => `${d}=${c}`).join(', ')}`);
  console.log(`Buka-tutup beruntun: ${clusterTrades} trade (${(clusterTrades / Math.max(1, trades) * 100).toFixed(0)}%) ketutup dalam kluster >=2 trade per ~15 menit, burst terbesar ${maxBurst} trade`);
  console.log(`NET setelah fee (dari journal): $${netUsd.toFixed(2)}`);
  console.log(`Ukuran posisi rata-rata (dari ${notionals.length} posisi yg kerekam): $${avgNotional.toFixed(0)} notional`);
  console.log(`Estimasi fee total (0,10%/sisi): $${estFee.toFixed(2)}  ->  estimasi GROSS sebelum fee: $${estGross.toFixed(2)}`);
  console.log(`Estimasi kalau fee 0,05%/sisi (taker BingX umum): NET ~ $${(estGross - estFee / 2).toFixed(2)}`);
  console.log(`Statistik REAL (kumulatif, gak dipotong periode): menang ${last.stats.real.wins}, kalah ${last.stats.real.losses}, PnL $${last.stats.real.totalPnlUsd.toFixed(2)}`);
}

if (require.main === module) main();
