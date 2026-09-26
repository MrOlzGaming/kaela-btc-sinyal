// systemInvariantCheck.js -- (5 Sep 2026, permintaan Olan: "telusuri pelan-pelan sistem kita,
// cari anomali... atau bikin debuger otomatis?") -- KEPUTUSAN: bukan "grep log cari kata error"
// (watchdog yang ada UDAH nangkep itu, lihat Watchdog.gs), tapi ngecek INVARIANT -- hal yang
// HARUSNYA selalu benar secara matematis/struktural, dan kalau nyimpang berarti ada bug SILENT
// (gak crash, gak muncul di log error) -- persis KELAS bug yang UDAH BERKALI-KALI kejadian di
// proyek ini: NAV pool salah baca kolom, PnL "-$300" palsu, SL kesundul salah skala 100x,
// boolean-string GAS. Grep-log gak akan pernah nangkep bug kayak gitu, invariant check bisa.
//
// Jalan tiap siklus (ditempel di run-vultr-executor.sh) -- MURAH (baca file JSON lokal doang, gak
// ada network call), gak pernah nulis/ubah apapun (READ-ONLY, murni deteksi).
//
// Kata "GAGAL" SENGAJA dipakai di baris temuan -- ini yang di-scan run-*-executor.sh buat lapor
// ke Watchdog/WA (pola SAMA kayak auditGithubActions.js, SATU jalur alert yang udah ada, gak
// bikin pipa notifikasi baru).

const fs = require('fs');
const { MAX_LEVERAGE } = require('./calculator');
const { hasEntryToday } = require('./archive');

function loadJson(f) {
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { __parseError: e.message }; }
}

function listJournalFiles() {
  const files = ['nyopet-journal.json', 'sniper-orders.json'];
  const stateDir = 'multi-account-state';
  if (fs.existsSync(stateDir)) {
    for (const f of fs.readdirSync(stateDir)) {
      if (f.endsWith('-nyopet.json') || f.endsWith('-sniper.json')) files.push(`${stateDir}/${f}`);
    }
  }
  return files;
}

function checkJournal(f, anomalies) {
  const j = loadJson(f);
  if (j == null) return; // file emang gak ada, wajar (member baru/belum pernah trading)
  if (j.__parseError) { anomalies.push(`${f}: GAGAL parse JSON -- ${j.__parseError}`); return; }
  const orders = j.orders || [];

  // 1) Order CLOSED tapi PnL null/undefined -- pernah kejadian NYATA (ketemu 5 Sep 2026 lewat
  // audit ini, journal demo lama, kemungkinan sisa bug yang udah kefix -- tapi check ini WAJIB
  // permanen biar kalau kejadian LAGI ketauan, bukan didiemin selamanya).
  //
  // ⛔ PENGECUALIAN `status==='closed_untracked'` (12 Sep 2026, fix bug "posisi ngarang") --
  // status ini KHUSUS posisi adopsi (mode:'unknown') yang closePosition() SENGAJA nutup dengan
  // pnlUsd/pnlPct null (JUJUR ngaku gak tau, drpd nebak angka yang kebukti ngarang -- lihat
  // komentar closePosition/nyopetAutoTrader.js). Null di sini BUKAN bug, itu PERILAKU BENAR --
  // exclude dari anomali, sama filosofinya kayak exclude mode==='unknown' di cek leverage bawah.
  for (const o of orders) {
    if (o.status && o.status.startsWith('closed') && o.status !== 'closed_untracked' && (o.pnlUsd == null || o.pnlPct == null)) {
      anomalies.push(`${f} #${o.id}: status=${o.status} tapi pnlUsd=${o.pnlUsd} pnlPct=${o.pnlPct} (closeReason=${o.closeReason || '-'}, triggeredAt=${o.triggeredAt})`);
    }
  }

  // 2) Leverage lewat cap global -- kalkulator SEHARUSNYA gak pernah ngasih ini, tapi order lama/
  // manual/bug baru bisa lolos.
  //
  // ⛔ FALSE POSITIVE ketemu 8 Sep 2026 (dikonfirmasi Olan: "aku sudah tak ada posisi kok, boleh
  // teliti kok"): entry `#nyopet-adopted-1788404534708` (3 Sep 2026, leverage 109x, closed_tp)
  // itu posisi MANUAL Olan langsung di Binance (bukan keputusan bot) -- Position Reconciler cuma
  // nyatet apa adanya pas kedeteksi di exchange, `mode`/`patternType` KEDUANYA "unknown" (penanda
  // order gak lewat jalur normal bot). Cap leverage global itu ATURAN buat KALKULATOR bot sendiri,
  // BUKAN buat trade manual Olan pake penilaian sendiri di exchange langsung -- exclude entry yang
  // `mode === 'unknown'` (adopted/manual, gak pernah lewat exposure calculator) dari cek ini, biar
  // gak alarm palsu SELAMANYA tiap siklus buat posisi lama yang udah closed berhari-hari.
  for (const o of orders) {
    if (o.leverage != null && o.leverage > MAX_LEVERAGE && o.mode !== 'unknown') {
      anomalies.push(`${f} #${o.id}: leverage=${o.leverage}x MELEBIHI cap global ${MAX_LEVERAGE}x`);
    }
  }

  // 3) Duplikat floating order per asset -- HARUSNYA mustahil (1 slot per aset), lock+guard
  // Fed Dovish Grid udah nutup celah race yang ketemu, ini jaring pengaman kalau ada celah LAIN.
  const floatingByAsset = {};
  for (const o of orders) {
    if (o.status === 'floating') (floatingByAsset[o.asset || 'unknown'] = floatingByAsset[o.asset || 'unknown'] || []).push(o.id);
  }
  for (const [asset, ids] of Object.entries(floatingByAsset)) {
    if (ids.length > 1) anomalies.push(`${f}: DUPLIKAT floating order asset=${asset} -> ${ids.join(', ')} (harusnya cuma 1 slot)`);
  }

  // 4) Harga/qty gak masuk akal
  for (const o of orders) {
    if ((o.entryPrice != null && o.entryPrice <= 0) || (o.qty != null && o.qty <= 0)) {
      anomalies.push(`${f} #${o.id}: entryPrice=${o.entryPrice} qty=${o.qty} (harusnya positif)`);
    }
  }

  // 5) Margin negatif
  for (const o of orders) {
    if (o.marginUsd != null && o.marginUsd < 0) anomalies.push(`${f} #${o.id}: marginUsd NEGATIF (${o.marginUsd})`);
  }

  // 6) Fed Dovish Grid: konsistensi internal (layerSizesFrac vs nilaiPosisi/marginUsd/layers)
  for (const o of orders) {
    if (o.patternType !== 'fed_dovish_grid' || !Array.isArray(o.layerSizesFrac)) continue;
    if (o.layerSizesFrac.length !== o.layers) {
      anomalies.push(`${f} #${o.id}: Fed Dovish Grid -- layers=${o.layers} tapi layerSizesFrac.length=${o.layerSizesFrac.length} (harusnya sama)`);
    }
    if (o.modalAtOpen > 0) {
      const totalFrac = o.layerSizesFrac.reduce((a, b) => a + b, 0);
      const expectedNilai = o.modalAtOpen * totalFrac;
      if (o.nilaiPosisi != null && Math.abs(o.nilaiPosisi - expectedNilai) > 0.01) {
        anomalies.push(`${f} #${o.id}: Fed Dovish Grid -- nilaiPosisi=${o.nilaiPosisi} tapi harusnya ${expectedNilai.toFixed(4)} (modalAtOpen x total layer fraction)`);
      }
    }
  }

  // 7) Tipe data saldo journal harus angka (bug lama GAS "boolean-string" dari sheet, versi Node
  // di sini beda kelas tapi prinsipnya sama -- field numerik yang diem-diem jadi string/NaN).
  for (const field of ['balanceUsdc', 'balanceUsdt', 'mexcBalanceUsdc', 'mexcBalanceUsdt']) {
    if (j[field] !== undefined && (typeof j[field] !== 'number' || Number.isNaN(j[field]))) {
      anomalies.push(`${f}: field "${field}" = ${JSON.stringify(j[field])} (${typeof j[field]}) -- harusnya angka valid`);
    }
  }
}

// 🐛 FIX 19 Sep 2026 (audit -- BUG-KAELATRADE-0012, "checklist Sniper bisa lapor 'done' palsu
// walau archive.json NOL entri hari itu") -- invariant GENERIK yang nutup KELAS bug ini
// PERMANEN, bukan cuma instance Sniper yang udah dibenerin: kalau trigger-state bilang "hari X
// udah beres", HARUS ADA minimal 1 entri archive.json tipe terkait di hari kalender WITA yang
// sama. Data-driven (bukan hardcode logic per-modul) biar gampang nambah entry baru kalau modul
// LAIN suatu saat punya pola trigger-state serupa (SATU baris tambahan, gak perlu fungsi baru).
const TRIGGER_STATE_CHECKS = [
  { statePath: 'sniper-trigger-state.json', dateField: 'lastSentDate', archiveType: 'sniper', label: 'Sniper' },
];

function checkTriggerStateVsArchive(anomalies) {
  for (const check of TRIGGER_STATE_CHECKS) {
    const state = loadJson(check.statePath);
    if (state == null || state.__parseError) continue; // file gak ada/rusak -- ranah check LAIN, bukan invariant ini
    const dateKey = state[check.dateField];
    if (!dateKey) continue; // belum pernah jalan sama sekali -- wajar, bukan anomali
    // Noon WITA (+08:00) -- aman dari edge-case timezone, `localDateKey()` di archive.js bakal
    // baliknya balik ke dateKey yang SAMA persis.
    const asDate = new Date(`${dateKey}T12:00:00+08:00`);
    if (Number.isNaN(asDate.getTime())) {
      anomalies.push(`${check.statePath}: field "${check.dateField}"="${dateKey}" bukan format tanggal valid`);
      continue;
    }
    if (!hasEntryToday(check.archiveType, asDate)) {
      anomalies.push(`${check.statePath}: ${check.label} ditandai "done" tanggal ${dateKey} TAPI archive.json NOL entri tipe "${check.archiveType}" di hari itu -- kelas bug BUG-KAELATRADE-0012, cek jalur addEntry yang mungkin ke-skip.`);
    }
  }
}

// Ninja (26 Sep 2026, permintaan Olan "sempurnakan Ninja" begitu real BingX mulai jalan) --
// journal-nya BEDA STRUKTUR TOTAL dari Sniper/Ranger (channel-breakout-journal.json, lihat
// ninjaTrader.js defaultJournal()): gak ada array `orders` sama sekali, cuma floating (posisi
// SEKARANG) + closedCount (angka) + stats.demo/real (agregat) per varian -- checkJournal() di
// atas gak nangkep apapun buat file ini (orders selalu undefined -> silently no-op), makanya
// invariant TERPISAH sendiri di sini.
function checkNinjaJournal(anomalies) {
  const f = 'channel-breakout-journal.json';
  const j = loadJson(f);
  if (j == null) return; // belum pernah jalan sama sekali -- wajar
  if (j.__parseError) { anomalies.push(`${f}: GAGAL parse JSON -- ${j.__parseError}`); return; }

  for (const variant of ['tpFixed', 'trailing']) {
    const v = j[variant];
    if (!v) continue;

    // 1) closedCount HARUS PERSIS sama kayak stats.demo.wins+losses -- demo SELALU dieksekusi
    // tiap sinyal (beda dari real yang bisa skip kalau saldo kurang/akun kotor), jadi keduanya
    // WAJIB sinkron 1:1. Nyimpang = closedCount ke-increment tanpa update stats (atau sebaliknya).
    if (v.stats && v.stats.demo && typeof v.closedCount === 'number') {
      const demoTotal = (v.stats.demo.wins || 0) + (v.stats.demo.losses || 0);
      if (demoTotal !== v.closedCount) {
        anomalies.push(`${f} [${variant}]: closedCount=${v.closedCount} tapi stats.demo.wins+losses=${demoTotal} (harusnya SAMA PERSIS, demo selalu dieksekusi tiap sinyal)`);
      }
      // 2) real WINS+LOSSES gak boleh lebih dari closedCount (real bisa skip, gak bisa lebih sering dari demo).
      if (v.stats.real) {
        const realTotal = (v.stats.real.wins || 0) + (v.stats.real.losses || 0);
        if (realTotal > v.closedCount) {
          anomalies.push(`${f} [${variant}]: stats.real.wins+losses=${realTotal} MELEBIHI closedCount=${v.closedCount} (mustahil, real gak bisa lebih sering trade dari demo)`);
        }
      }
    }

    // 3) totalPnlUsd numerik valid (kelas bug SAMA kayak cek #7 checkJournal di atas).
    for (const mode of ['demo', 'real']) {
      const s = v.stats && v.stats[mode];
      if (s && (typeof s.totalPnlUsd !== 'number' || Number.isNaN(s.totalPnlUsd))) {
        anomalies.push(`${f} [${variant}.${mode}]: totalPnlUsd=${JSON.stringify(s.totalPnlUsd)} (${typeof s.totalPnlUsd}) -- harusnya angka valid`);
      }
    }

    // 4) Floating posisi (kalau ada) -- harga/qty masuk akal, arah valid.
    if (v.floating) {
      if (v.floating.dir !== 'long' && v.floating.dir !== 'short') {
        anomalies.push(`${f} [${variant}]: floating.dir="${v.floating.dir}" (harusnya 'long'/'short')`);
      }
      for (const mode of ['demo', 'real']) {
        const sub = v.floating[mode];
        if (sub && (!(sub.entryPrice > 0) || !(sub.quantity > 0))) {
          anomalies.push(`${f} [${variant}].floating.${mode}: entryPrice=${sub.entryPrice} quantity=${sub.quantity} (harusnya positif)`);
        }
      }
    }
  }
}

function main() {
  const anomalies = [];
  for (const f of listJournalFiles()) checkJournal(f, anomalies);
  checkNinjaJournal(anomalies);
  checkTriggerStateVsArchive(anomalies);

  if (anomalies.length === 0) {
    console.log('[SystemInvariantCheck] Semua invariant journal Sniper/Ranger/Ninja OK, gak ada anomali.');
    return;
  }
  // Kata "GAGAL" SENGAJA -- di-scan run-*-executor.sh, relay ke Watchdog/WA (pola sama auditGithubActions.js).
  for (const a of anomalies) console.log(`[SystemInvariantCheck] GAGAL: ${a}`);
}

main();
