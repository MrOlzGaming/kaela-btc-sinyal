// whaleNetflowResearchLog.js -- arsip riset "exchange netflow" harian (12 Sep 2026, permintaan
// Olan lanjutan upgrade whale alert: "gabungin ke teknikal makin gacor").
//
// KONTEKS PENTING: exchange netflow SEBAGAI SINYAL TRADING udah PERNAH dites dulu dan GAGAL
// (lihat "Riset yang SUDAH SELESAI dieksplorasi" di project-kaela-btc-sinyal.md -- "exchange
// netflow on-chain: dites, BELUM ngalahin baseline"). TAPI riset lama itu kemungkinan pakai data
// atribusi yang JAUH lebih lemah drpd sekarang (exchangeAddresses.js SEKARANG pakai WalletExplorer,
// jutaan alamat vs 6 dulu) -- worth DICOBA ULANG dengan data baru ini, TAPI butuh histori numpuk
// dulu beberapa bulan sebelum backtest yang jujur bisa dilakuin (sample kecil = kesimpulan gak
// bisa dipercaya, SAMA disiplin kayak semua riset lain di proyek ini).
//
// Dipanggil whaleDailyDigest.js SETELAH digest harian kelar dihitung. Append-only, MURNI LOKAL
// (state runtime, regeneratable dari re-scan blockchain kalau perlu -- gitignored).
//
// ⛔ INI CUMA ARSIP -- gak pernah pengaruhi sinyal/eksekusi trading apapun. Backtest beneran
// (kalau datanya udah cukup numpuk) WAJIB dilaporin+minta izin Olan dulu sebelum diterapkan ke
// sistem live, sama kayak semua riset lain.

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'whale-netflow-research-log.json');

function loadAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return []; }
}
function saveAll(arr) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(arr, null, 2));
}

// `btcPriceUsd` -- harga BTC PAS digest ini dihitung (bukan harga di masa depan, itu belum
// kejadian). Buat backtest NANTI (join sama histori harga harian beneran, mis. via
// backtest/fetchKlines.js), BUKAN dihitung di sini -- logging cuma nyatet apa yang KETAHUAN saat
// itu, analisa "apa yang terjadi setelahnya" dikerjain belakangan pas datanya udah cukup.
function recordDailyNetflow({ dateKey, totalBtc, count, toExchangeBtc, fromExchangeBtc, btcPriceUsd }) {
  const arr = loadAll();
  if (arr.some((e) => e.dateKey === dateKey)) return; // udah kecatet hari ini, jangan dobel
  arr.push({
    dateKey,
    recordedAt: new Date().toISOString(),
    totalBtc, count, toExchangeBtc, fromExchangeBtc,
    netFlowBtc: fromExchangeBtc - toExchangeBtc, // POSITIF = net KELUAR exchange (akumulasi), NEGATIF = net MASUK (potensi jual)
    btcPriceUsd,
  });
  saveAll(arr);
}

module.exports = { recordDailyNetflow, loadAll, LOG_PATH };
