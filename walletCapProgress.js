// walletCapProgress.js (20 Sep 2026, ide lanjutan dari kebijakan setoran bulanan -- lihat memori
// project-kaela-monthly-funding.md) -- snapshot progress 4 dompet trading Kaela (Sniper/Nyopet
// BTC/Emas) menuju cap $1000/dompet. BEDA dari monthlyFundingReminder.js: itu kirim WA SEKALI
// tanggal 5 doang (gated), ini nulis snapshot PUBLIK tiap siklus (~15 menit, TANPA gating tanggal)
// biar dashboard Kaela Access (tab Developer, kartu WIBOWO HEDGE FUND, owner-only) bisa nampilin
// progress LIVE -- bukan cuma pas nunggu WA bulanan.
//
// Ditulis ke web/wallet-cap-progress.json (dashboard fetch langsung dari GitHub raw, pola SAMA
// kayak sniper-orders.json/nyopet-journal.json di dashboard-load.js -- data berubah tiap siklus,
// jsDelivr purge kadang telat). Reuse WALLETS/CAP_PER_WALLET/fetchBalance dari
// monthlyFundingReminder.js, JANGAN duplikat definisi dompet di sini.
//
// 21 Sep 2026 -- juga nulis web/wallet-cap-progress-history.json (1 titik/HARI, bukan 1/siklus --
// chart pertumbuhan gak butuh resolusi 15 menit, dan 1/hari bikin filenya kecil selamanya, gak
// perlu trim agresif). Cuma simpen ANGKA GABUNGAN (totalBalance/totalCap), BUKAN breakdown per
// dompet -- samain sama keputusan Olan 20 Sep soal widget agregat shareholder (pola setoran/
// prioritas dompet tetap privat, cuma total pool yang dibagi ke Saham Saya). Logic histori
// (upsert/loadHistory/proyeksi) ada di walletCapHistory.js (file TERPISAH, lihat komentar di
// situ -- circular require kalau digabung ke sini, karena file ini require monthlyFundingReminder.js
// juga).

const fs = require('fs');
const path = require('path');
const { WALLETS, CAP_PER_WALLET, fetchBalance } = require('./monthlyFundingReminder');
const { loadHistory, upsertHistoryEntry } = require('./walletCapHistory');

const OUT_PATH = path.join(__dirname, 'web', 'wallet-cap-progress.json');

function loadSecrets() {
  try { return require('./secrets'); } catch { return {}; }
}

// Pure function biar gampang ditest -- pct dibulatin 1 desimal, dicap 100 (balance bisa lewat cap
// dikit di antara siklus sebelum Olan sadar berhenti isi, jangan sampai progress bar > 100%).
function computeProgress(balance, cap) {
  return Math.min(100, Math.round((balance / cap) * 1000) / 10);
}

// WITA (UTC+8) -- pola SAMA kayak witaDateKey balanceAlert.js, biar "hari" konsisten sama zona
// waktu Olan (bukan UTC polos yang bisa geser tanggal beda hari pas malam WITA).
function witaDateKey(d) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const secrets = loadSecrets();
  const wallets = [];
  for (const w of WALLETS) {
    try {
      const balance = await fetchBalance(w, secrets);
      wallets.push({ key: w.key, label: w.label, balance: Math.round(balance * 100) / 100, cap: CAP_PER_WALLET, pct: computeProgress(balance, CAP_PER_WALLET) });
    } catch (e) {
      console.log(`[WalletCapProgress] Gagal ambil saldo ${w.label} (${e.message}) -- skip siklus ini.`);
    }
  }
  // Kalau ADA yang gagal, jangan timpa file lama pakai data PARSIAL (dashboard bakal nampilin 3
  // dompet doang seolah yang ke-4 gak ada, lebih membingungkan drpd nampilin data siklus sebelumnya
  // yang telat dikit). Coba lagi siklus berikutnya.
  if (wallets.length !== WALLETS.length) {
    console.log('[WalletCapProgress] Gak semua dompet kebaca, snapshot lama dipertahankan.');
    return;
  }
  const now = new Date();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({ updatedAt: now.toISOString(), wallets }, null, 2));

  const totalBalance = Math.round(wallets.reduce((s, w) => s + w.balance, 0) * 100) / 100;
  const totalCap = wallets.reduce((s, w) => s + w.cap, 0);
  const history = upsertHistoryEntry(loadHistory(), witaDateKey(now), totalBalance, totalCap);
  fs.writeFileSync(path.join(__dirname, 'web', 'wallet-cap-progress-history.json'), JSON.stringify(history, null, 2));
  console.log('[WalletCapProgress] Snapshot + histori ditulis.');
}

module.exports = { main, computeProgress };
if (require.main === module) { main().catch((e) => console.log('[WalletCapProgress] ERROR:', e.message)); }
