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
  for (const o of orders) {
    if (o.status && o.status.startsWith('closed') && (o.pnlUsd == null || o.pnlPct == null)) {
      anomalies.push(`${f} #${o.id}: status=${o.status} tapi pnlUsd=${o.pnlUsd} pnlPct=${o.pnlPct} (closeReason=${o.closeReason || '-'}, triggeredAt=${o.triggeredAt})`);
    }
  }

  // 2) Leverage lewat cap global -- kalkulator SEHARUSNYA gak pernah ngasih ini, tapi order lama/
  // manual/bug baru bisa lolos.
  for (const o of orders) {
    if (o.leverage != null && o.leverage > MAX_LEVERAGE) {
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

function main() {
  const anomalies = [];
  for (const f of listJournalFiles()) checkJournal(f, anomalies);

  if (anomalies.length === 0) {
    console.log('[SystemInvariantCheck] Semua invariant journal Nyopet/Sniper OK, gak ada anomali.');
    return;
  }
  // Kata "GAGAL" SENGAJA -- di-scan run-*-executor.sh, relay ke Watchdog/WA (pola sama auditGithubActions.js).
  for (const a of anomalies) console.log(`[SystemInvariantCheck] GAGAL: ${a}`);
}

main();
