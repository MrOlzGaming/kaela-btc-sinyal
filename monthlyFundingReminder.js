// monthlyFundingReminder.js -- Pengingat setoran bulanan $100 ke Wibowo Hedgefund (20 Sep 2026,
// kebijakan tetap Olan -- lihat memori project-kaela-monthly-funding.md buat latar belakang
// lengkap: split $30/$40/$20/$10 dasarnya backtest baseline 2020-2026, cap $1000 dari minimum
// order Binance/MEXC + zona bahaya bracket exposure Nyopet BTC).
//
// Tanggal 5 tiap bulan, cek saldo REAL 4 dompet (Binance USDT=Sniper BTC, Binance USDC=Nyopet
// BTC, MEXC USDT=Sniper Emas, MEXC USDC=Nyopet Emas), saranin split $100 SECARA DINAMIS:
// - Dompet yang udah $1000+ ("capped") -- jatahnya dialihin ke dompet lain yang MASIH DI BAWAH
//   $1000, proporsional rasio asal 3:4:2:1 (Olan eksplisit: "isi futures abis-abisan dulu").
// - Kalau SEMUA 4 dompet capped, $100 disaranin ke Compound Alt DCA (10 koin, $10/koin -- PAS
//   banget sama PER_COIN_USD yang udah ada di spotDcaAltShared.js, bukan kebetulan direncanakan).
// - STOP kirim begitu window Tanam habis (>= HALVING_DATE) -- patokan siklus halving, SAMA
//   persis kayak Compound Alt DCA sendiri (Olan: "patokannya btc halving... tunggu musim panen").
//
// Total wallet REAL (bukan cuma saldo bebas) -- Binance getWalletBalance UDAH termasuk margin
// yang lagi kekunci di posisi terbuka (dikonfirmasi komentar binanceExecutor.js). MEXC gak punya
// endpoint total serupa -- availableBalance doang -- jadi kalau ada posisi Emas lagi kebuka,
// margin-nya DIHITUNG MANUAL dari getAllPositions() (notional/leverage per simbol) dan
// ditambahin ke availableBalance (20 Sep 2026, permintaan Olan: "kalo di mexc ada posisi, sistem
// bisa ingat kan?" -- YA, sekarang eksplisit ngitung, bukan cuma saldo bebas doang). Aman dipakai
// karena Olan konfirmasi 2 akun (Binance+MEXC) gak disentuh manual lagi semenjak insiden FOMC --
// SEMUA posisi yang ada pasti punya Kaela sendiri, gak ada posisi asing yang perlu disaring.
//
// Dipanggil TIAP SIKLUS (~15 menit) dari run-vultr-executor.sh, SELF-GATING internal (state file
// lastSentMonthKey) -- pola SAMA kayak spotDca.js/spotDcaAlt.js, aman dipanggil berkali-kali.
//
// "Mention" Olan: Fonnte gak dukung mention WA asli (dicek sebelumnya, lihat
// feedback-wa-signature-kaela / catatan proyek) -- callout teks bold polos di awal pesan.

const fs = require('fs');
const path = require('path');
const { createBinanceClient } = require('./binanceExecutor');
const { createMexcClient } = require('./mexcExecutor');
const { sendWhatsAppToWibowo } = require('./wibowoNotify');
const { HALVING_DATE, ALT10_SYMBOLS, monthKey } = require('./spotDcaAltShared');
const { loadHistory, estimateMonthsToCap } = require('./walletCapHistory');

const STATE_PATH = path.join(__dirname, 'monthly-funding-reminder-state.json');
const MONTHLY_TOTAL = 100;
const CAP_PER_WALLET = 1000;
const REMINDER_DAY = 5; // tanggal 5 kalender (UTC) -- SAMA kayak MONTHLY_BUY_DAY Compound Alt DCA

const WALLETS = [
  { key: 'sniperBtc', label: '🎯 Sniper BTC', exchange: 'binance', asset: 'USDT', share: 30 },
  { key: 'nyopetBtc', label: '🏹 Ranger BTC', exchange: 'binance', asset: 'USDC', share: 40 },
  // execSymbol (30 Agu 2026, assetConfig.js/rangerAssetConfig.js) -- dipakai buat cocokin posisi
  // terbuka MEXC ke wallet yang bener (Sniper Emas XAUT_USDT vs Ranger Emas PAXG_USDC, 1 akun
  // MEXC yang sama, dibedain dari SIMBOL kontraknya doang).
  { key: 'sniperEmas', label: '🎯 Sniper Emas', exchange: 'mexc', asset: 'USDT', execSymbol: 'XAUT_USDT', share: 20 },
  { key: 'nyopetEmas', label: '🏹 Ranger Emas', exchange: 'mexc', asset: 'USDC', execSymbol: 'PAXG_USDC', share: 10 },
];

function loadState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return { lastSentMonthKey: null };
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function loadSecrets() {
  try { return require('./secrets'); } catch { return {}; }
}

// Balance REAL selalu mainnet (testnet: false eksplisit) -- ini laporan uang beneran, TIDAK
// boleh ikut global isTestnet() (yang ngatur mode eksekusi trading, bukan buat cek modal setor).
// 🐛 FIX 26 Sep 2026 (Watchdog lapor 401 "Invalid API-key" 1000+ kali di histori log, Olan
// eksplisit minta ditelusuri) -- SEBELUM ini baca `secrets.BINANCE_API_KEY` (key DEMO,
// demo-fapi.binance.com) tapi dipakai buat manggil MAINNET (`testnet: false` di atas) -- ketuker
// nama variabel, BUKAN masalah IP/permission kayak pesan errornya. Key demo emang TOLAK
// permanen di endpoint real (beda sistem total, lihat catatan Accounts.gs kaela-multi-akun).
// `BINANCE_API_KEY_REAL` masih kosong (Olan belum topup, rencana 5 Okt 2026) -- throw
// "belum disetup" (skip bersih, SAMA pola kayak execFor return null di ninjaTrader.js) jauh
// lebih murah/jujur drpd 1000+ percobaan HTTP nyata ke Binance yang emang pasti gagal terus.
async function fetchBalance(wallet, secrets) {
  if (wallet.exchange === 'binance') {
    if (!secrets.BINANCE_API_KEY_REAL || !secrets.BINANCE_API_SECRET_REAL) throw new Error('Binance API key REAL belum disetup.');
    const client = createBinanceClient({ apiKey: secrets.BINANCE_API_KEY_REAL, apiSecret: secrets.BINANCE_API_SECRET_REAL, testnet: false });
    return client.getWalletBalance(wallet.asset);
  }
  if (!secrets.MEXC_API_KEY || !secrets.MEXC_API_SECRET) throw new Error('MEXC API key belum disetup.');
  const client = createMexcClient({ apiKey: secrets.MEXC_API_KEY, apiSecret: secrets.MEXC_API_SECRET });
  const [available, positions] = await Promise.all([client.getAccountBalance(wallet.asset), client.getAllPositions()]);
  const ownPosition = positions.find((p) => p.symbol === wallet.execSymbol);
  const positionMargin = ownPosition && Number(ownPosition.leverage) > 0
    ? Math.abs(Number(ownPosition.notional)) / Number(ownPosition.leverage)
    : 0;
  return available + positionMargin;
}

// Dompet yang UDAH di bawah cap dapet jatah PROPORSIONAL sama rasio asalnya (3:4:2:1) -- kalau
// cuma tinggal 1 dompet terbuka, otomatis dia dapet FULL $100 (pembagian proporsional 1 anggota
// = 100% jatahnya, gak perlu case terpisah). Kalau NOL dompet terbuka (semua capped) -> mode 'spot'.
function computeSplit(balances) {
  const open = balances.filter((w) => w.balance < CAP_PER_WALLET);
  const capped = balances.filter((w) => w.balance >= CAP_PER_WALLET);
  if (open.length === 0) return { mode: 'spot', capped, allocations: [] };

  const totalShareOpen = open.reduce((s, w) => s + w.share, 0);
  const allocations = open.map((w) => ({ ...w, amount: Math.round((w.share / totalShareOpen) * MONTHLY_TOTAL * 100) / 100 }));
  // Pembulatan bisa nyisain selisih sen dari $100 PERSIS -- dibebanin ke alokasi TERBESAR (paling
  // gak berasa proporsinya) biar total SELALU pas $100.00, bukan $99.99/$100.01.
  const diff = Math.round((MONTHLY_TOTAL - allocations.reduce((s, a) => s + a.amount, 0)) * 100) / 100;
  if (diff !== 0) {
    const biggest = allocations.reduce((a, b) => (b.amount > a.amount ? b : a));
    biggest.amount = Math.round((biggest.amount + diff) * 100) / 100;
  }
  return { mode: 'futures', capped, allocations };
}

// estimateMonths (21 Sep 2026, "berapa bulan lagi Modal Futures Pool penuh") -- OPSIONAL,
// null/undefined = ZERO perubahan tampilan (baris ini di-skip). Cuma ditampilin mode 'futures'
// (mode 'spot' berarti udah capped semua, gak relevan lagi diproyeksi).
function formatMessage(now, balances, split, estimateMonths) {
  const dateStr = now.toISOString().slice(0, 10);
  const lines = [`🔔 *Pengingat Setoran Bulanan Kaela* -- ${dateStr}`, '', `*Olan,* ini saldo 4 dompet sekarang:`];
  balances.forEach((w) => {
    const status = w.balance >= CAP_PER_WALLET ? '✅ CAPPED ($1000+)' : 'di bawah cap';
    lines.push(`${w.label}: $${w.balance.toFixed(2)} -- ${status}`);
  });
  lines.push('');
  if (split.mode === 'futures') {
    lines.push(`💰 Saran setoran $${MONTHLY_TOTAL} bulan ini:`);
    split.allocations.forEach((a) => lines.push(`  ${a.label}: $${a.amount.toFixed(2)}`));
    if (split.capped.length > 0) {
      lines.push('', `(${split.capped.map((c) => c.label).join(', ')} udah capped -- jatahnya dialihin ke dompet di atas, bukan porsi tetap lama.)`);
    }
    if (typeof estimateMonths === 'number' && estimateMonths > 0) {
      lines.push('', `📅 Estimasi kasar (tren 30 hari terakhir): ~${estimateMonths} bulan lagi Modal Futures Pool (gabungan 4 dompet) penuh $${CAP_PER_WALLET * WALLETS.length}.`);
    }
  } else {
    const perCoin = Math.round((MONTHLY_TOTAL / ALT10_SYMBOLS.length) * 100) / 100;
    lines.push(`🌱 SEMUA 4 dompet futures udah capped $1000+ -- $${MONTHLY_TOTAL} bulan ini disaranin ke *Compound Alt DCA* (spot, 10 koin):`);
    ALT10_SYMBOLS.forEach((s) => lines.push(`  ${s.replace('USDT', '')}: $${perCoin.toFixed(2)}`));
  }
  lines.push('', '(Ini SARAN doang -- setoran manual tetap kamu yang eksekusi sendiri, Kaela gak pegang akses transfer dana.)');
  return lines.join('\n');
}

async function main() {
  const now = new Date();
  if (now.getUTCDate() !== REMINDER_DAY) return;
  if (now >= HALVING_DATE) {
    console.log('[MonthlyFundingReminder] Window Tanam udah habis (lewat HALVING_DATE) -- reminder rutin berhenti sampai siklus Tanam berikutnya.');
    return;
  }
  const state = loadState();
  const mk = monthKey(now);
  if (state.lastSentMonthKey === mk) return; // udah kekirim bulan ini, jangan dobel

  const secrets = loadSecrets();
  const balances = [];
  for (const w of WALLETS) {
    try {
      const balance = await fetchBalance(w, secrets);
      balances.push({ ...w, balance });
    } catch (e) {
      console.log(`[MonthlyFundingReminder] Gagal ambil saldo ${w.label} (${e.message}) -- skip siklus ini, coba lagi siklus berikutnya (state belum ditandai kekirim).`);
      return;
    }
  }

  const split = computeSplit(balances);
  const totalBalance = balances.reduce((s, w) => s + w.balance, 0);
  const estimateMonths = estimateMonthsToCap(loadHistory(), totalBalance, CAP_PER_WALLET * WALLETS.length);
  const msg = formatMessage(now, balances, split, estimateMonths);
  console.log(msg);
  await sendWhatsAppToWibowo(msg);
  saveState({ lastSentMonthKey: mk });
  console.log('[MonthlyFundingReminder] Pengingat bulan ini terkirim ke Wibowo Hedgefund.');
}

module.exports = { main, computeSplit, formatMessage, fetchBalance, WALLETS, CAP_PER_WALLET, MONTHLY_TOTAL };
if (require.main === module) { main().catch((e) => console.log('[MonthlyFundingReminder] ERROR:', e.message)); }
