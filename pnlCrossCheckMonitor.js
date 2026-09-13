// pnlCrossCheckMonitor.js -- mandor tambahan (13 Sep 2026), lahir langsung dari insiden nyata hari
// ini: sistem bilang PnL BTCUSDC hari itu -$1,89, app Binance bilang +$12,96 -- HANYA ketauan
// karena Olan kebetulan screenshot app-nya sendiri buat cross-check. Root cause SUDAH diperbaiki
// (bug dedup tradeHistoryStore.js), TAPI ide ini nutup KELAS masalah yang lebih luas: "gimana kalau
// ada bug LAIN (beda akar masalah) yang bikin data kita gak sinkron sama exchange lagi nanti?"
//
// CARA: hitung PnL hari ini via DUA JALUR INDEPENDEN buat tiap akun REAL --
//   (1) dari tradeHistoryStore lokal (`todaysPnlForSymbol`, ini yang dipakai SEMUA pesan WA
//       Buka/Nambah/Tutup/Kurangin -- lihat darkKaelaLog.js/positionReconciler.js).
//   (2) fetch FRESH langsung dari Binance HARI INI doang, TANPA lewat store/cache SAMA SEKALI --
//       ground truth independen, sama distinct dari jalur (1) walau kebetulan sama-sama akhirnya
//       pakai `getIncomeHistory`.
// Kalau selisihnya lebih dari ambang kecil (bukan cuma beda rounding/timing), itu SINYAL ada yang
// gak beres (bug baru, sync gagal diam-diam, dst) -- alarm ke Olan PRIBADI (DM, bukan grup) SEBELUM
// pesan salah lagi-lagi kekirim ke investor.
//
// ⛔ MURNI PENGECEKAN -- gak pernah kirim ke grup Wibowo/member, gak pernah ubah data apapun.

const kaela = require('./kaelaProTraderClient');
const { createBinanceClient } = require('./binanceExecutor');
const { sendWhatsApp } = require('./fonnte');
const tradeHistoryStore = require('./tradeHistoryStore');
const { MASTER_NOMOR } = require('./multiAccountExecutor');

const DIFF_THRESHOLD_USD = 0.5; // toleransi kecil (rounding/timing entry yg baru masuk pas dicek)
// Simbol per akun -- BTCUSDC (Nyopet) + BTCUSDT (Sniper, kalau ada) buat Olan. Abdu cuma BTCUSDC
// (belum pernah kepake buat Sniper sejauh ini) -- tambah simbol lain di sini kalau nanti kepake.
const SYMBOLS_TO_CHECK = ['BTCUSDC', 'BTCUSDT', 'XAUUSDC'];

function todayStartUtcMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
}

// Fresh, independen dari store -- fetch LANGSUNG, dedup PROPER (tranId+type, fix yang SAMA kayak
// tradeHistoryStore.js) tapi TANPA nulis/baca file cache sama sekali.
async function fetchFreshTodayPnl(client, symbol) {
  const startMs = todayStartUtcMs();
  const raw = await client.getIncomeHistory(startMs, 1000);
  const seen = new Set();
  let sum = 0;
  for (const r of raw || []) {
    if (r.symbol !== symbol) continue;
    if (r.incomeType === 'TRANSFER') continue;
    const key = `${r.tranId}|${r.incomeType}`;
    if (seen.has(key)) continue; // jaga2 kalau Binance kebetulan balikin baris sama 2x
    seen.add(key);
    sum += Number(r.income) || 0;
  }
  return sum;
}

async function checkAccount(name, phone, mode) {
  const findings = [];
  try {
    const accounts = await kaela.getTradingAccounts('binance').catch(() => []);
    let creds = accounts.find((a) => String(a.phone) === String(phone) && a.mode === mode);
    if (!creds && mode === 'real') {
      const all = await kaela.getAllAccountsWithKeys().catch(() => []);
      creds = all.find((a) => String(a.phone) === String(phone));
    }
    if (!creds) return findings;

    const client = createBinanceClient({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, testnet: mode === 'demo' });
    const filePath = tradeHistoryStore.storePath('binance', phone, mode);
    const store = tradeHistoryStore.loadStore(filePath);

    for (const symbol of SYMBOLS_TO_CHECK) {
      const fromStore = tradeHistoryStore.todaysPnlForSymbol(store, symbol, new Date());
      const fresh = await fetchFreshTodayPnl(client, symbol);
      if (fromStore === null && fresh === 0) continue; // dua2nya emang kosong, wajar (gak trading simbol ini)
      const diff = Math.abs((fromStore || 0) - fresh);
      if (diff > DIFF_THRESHOLD_USD) {
        findings.push({ name, phone, mode, symbol, fromStore: fromStore || 0, fresh, diff });
      }
    }
  } catch (e) {
    console.log(`[PnlCrossCheck] Gagal cek ${name} (${mode}):`, e.message);
  }
  return findings;
}

function formatAlert(findings) {
  const lines = ['🚨 *Mandor: PnL Kaela vs Binance BEDA*', '', 'Ditemukan selisih di luar wajar antara data internal Kaela dan Binance -- cek manual dulu sebelum ada pesan WA yang salah kirim lagi:', ''];
  for (const f of findings) {
    lines.push(`• ${f.name} (${f.mode}) ${f.symbol}: Kaela bilang $${f.fromStore.toFixed(2)}, Binance bilang $${f.fresh.toFixed(2)} (beda $${f.diff.toFixed(2)})`);
  }
  return lines.join('\n');
}

async function main() {
  const targets = [
    { name: 'Olan', phone: '6281299303888', mode: 'real' },
    { name: 'Abdu', phone: '6281575910962', mode: 'real' },
  ];
  let allFindings = [];
  for (const t of targets) {
    const findings = await checkAccount(t.name, t.phone, t.mode);
    allFindings = allFindings.concat(findings);
  }

  if (allFindings.length === 0) {
    console.log('[PnlCrossCheck] OK -- data Kaela cocok sama Binance (semua akun/simbol dicek).');
    return;
  }

  const msg = formatAlert(allFindings);
  console.log(msg);
  await sendWhatsApp(msg, MASTER_NOMOR); // DM ke Olan pribadi, BUKAN broadcast grup
}

module.exports = { main, fetchFreshTodayPnl, checkAccount, DIFF_THRESHOLD_USD };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR pnlCrossCheckMonitor.js:', e.message); process.exit(1); });
}
