// Anomaly Scanner -- rekam histori indikator kita SENDIRI tiap hari, lapor kalau ada yang keluar
// jauh dari kebiasaan historisnya. 22 Agu 2026, permintaan Olan ("aku pengen Kaela beneran makin
// pinter... kritis terhadap data, kayak Burry The Big Short") -- bagian dari "Kaela analis tier
// Bloomberg" (lihat memori project-kaela-analyst-tier).
//
// Metode: robust z-score (median + MAD, BUKAN mean+stddev biasa -- MAD lebih tahan sama outlier
// ekstrem yang justru sering muncul di data finansial, jadi gak gampang "keracunan" data lama).
// DIVALIDASI via backtest data historis FRED beneran (Credit Spread + Yield Curve, puluhan tahun)
// sebelum dipasang live -- z>=2.5 nangkep klaster kejadian NYATA (Agustus 2024 gejolak carry-trade
// global, dst), bukan noise acak.
//
// Butuh minimal 20 hari histori numpuk dulu per indikator sebelum mulai evaluasi (statistik gak
// bisa dipercaya kalau sample-nya kurang) -- sama filosofinya kayak squeezeDetector.js nunggu OI.

const fs = require('fs');
const path = require('path');
const { fetchAdvancedMacroContext } = require('./advancedMacro');
const { fetchGoldCotContext } = require('./cotReport');
const { fetchBtcNasdaqRegime, fetchGoldDxyRegime } = require('./regimeTracker');
const { sendWhatsApp } = require('./fonnte');
const { addEntry } = require('./archive');
const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');
const WHALE_STATE_PATH = path.join(__dirname, 'whale-state.json');

const STATE_PATH = path.join(__dirname, 'anomaly-history.json');
const MIN_HISTORY = 20;
const MAX_HISTORY = 200; // ~6-7 bulan data harian, cukup buat konteks tanpa file numpuk selamanya
const Z_THRESHOLD = 2.5;
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari -- anomali yang MASIH sama gak diulang-ulang lapor tiap hari

const TRACKED_LABELS = {
  dvol: '🌊 DVOL (Volatilitas BTC)',
  fedRate: '🏦 Fed Funds Rate',
  creditSpread: '📊 Credit Spread (High-Yield)',
  yieldCurve: '📉 Yield Curve 10Y-2Y',
  m2YoY: '💵 M2 Money Supply (YoY)',
  stablecoinGrowth: '💰 Stablecoin Supply (7 hari)',
  cotNetPct: '🏦 COT Smart Money Emas (% net-long)',
  btcNasdaqCorr: '🔗 Korelasi BTC-Nasdaq (90 hari)',
  goldDxyCorr: '🔗 Korelasi Emas-DXY (90 hari)',
  whaleVolumeBtc: '🐋 Total BTC Pindah Transaksi Raksasa (harian)',
  whaleTxCount: '🐋 Jumlah Transaksi Raksasa (harian)',
  whaleToExchangeBtc: '🔴 BTC Masuk Exchange (harian)',
  whaleFromExchangeBtc: '🟢 BTC Keluar Exchange (harian)',
};

// 12 Sep 2026, permintaan Olan ("percuma baca itu tapi ga ada penjelasan inti.. anggap pembaca
// itu trader awam") -- pesan lama cuma angka+z-score doang, gak jelasin APA indikatornya dan
// KENAPA trader BTC harus peduli. Ditulis kayak jelasin ke temen yang belum ngerti istilah
// finansial sama sekali -- {above}/{below} beda kalimat tergantung arah anomalinya (z positif
// = di atas kebiasaan, z negatif = di bawah).
const EXPLANATIONS = {
  dvol: {
    above: 'DVOL (nama resmi indeks volatilitas BTC dari bursa Deribit) itu kayak "ukuran rasa was-was" pasar options buat BTC (mirip VIX di saham). Lagi TINGGI dari biasanya -- banyak trader gede bayar mahal buat proteksi diri, karena ngerasa harga BTC bakal gerak KENCANG (bisa naik ATAU turun, gak nentuin arah). Biasanya muncul pas ada ketidakpastian besar.',
    below: 'DVOL (nama resmi indeks volatilitas BTC dari bursa Deribit) itu kayak "ukuran rasa was-was" pasar options buat BTC. Lagi RENDAH dari biasanya -- pasar ngerasa tenang, gak nyangka bakal ada gejolak. Sering kejadian pas harga lama sideways -- kadang disebut "tenang sebelum badai", tapi gak selalu jadi badai beneran.',
  },
  fedRate: {
    above: 'Fed Rate itu "harga sewa uang" yang ditentuin bank sentral Amerika. Berubah drastis dari biasanya -- biaya pinjam uang jadi lebih mahal, orang lebih milih nyimpen di deposito/obligasi aman drpd taruh di aset berisiko kayak BTC. Ini bisa bikin BTC tertekan.',
    below: 'Fed Rate itu "harga sewa uang" yang ditentuin bank sentral Amerika. Berubah drastis dari biasanya -- pinjam uang jadi lebih murah, orang lebih berani taruh duit di aset berisiko kayak BTC buat cari untung lebih gede.',
  },
  creditSpread: {
    above: 'Ini ngukur seberapa "takut" investor pegang obligasi perusahaan yang agak berisiko. MELEBAR jauh dari biasanya -- investor lagi was-was banget soal ekonomi. Histori-nya, pas ini kejadian, BTC & saham SERING ikut kejual bareng (dianggap sama-sama "aset berisiko").',
    below: 'Ini ngukur seberapa "takut" investor pegang obligasi perusahaan yang agak berisiko. MENYEMPIT jauh dari biasanya -- investor lagi santai/percaya diri soal ekonomi, kondisi kayak gini biasanya mendukung aset berisiko (termasuk BTC) buat naik.',
  },
  yieldCurve: {
    above: 'Ini ngukur bunga obligasi Amerika jangka PANJANG (10 tahun) dibanding jangka PENDEK (2 tahun). Lebih lebar dari biasanya -- biasanya tanda ekonomi dianggap sehat/normal, gak ada sinyal resesi deket-deket ini.',
    below: 'Ini ngukur bunga obligasi Amerika jangka PANJANG (10 tahun) dibanding jangka PENDEK (2 tahun). Lebih sempit/negatif dari biasanya -- histori PANJANG nunjukin ini sering jadi "alarm dini" resesi 1-2 tahun ke depan. Bukan berarti BTC langsung jatuh SEKARANG, tapi ini radar makro besar yang dipantau serius analis institusional.',
  },
  m2YoY: {
    above: '"M2" itu istilah resmi buat salah satu cara ngitung TOTAL duit yang beredar di ekonomi Amerika (uang tunai + tabungan + deposito dst). "YoY" (Year-over-Year) artinya dibandingin sama setahun lalu. Lagi tumbuh LEBIH CEPAT dari biasanya -- makin banyak duit "ngider" di sistem keuangan, sebagian sering nyari tempat parkir di aset kayak saham/BTC (bisa dorong harga naik).',
    below: '"M2" itu istilah resmi buat salah satu cara ngitung TOTAL duit yang beredar di ekonomi Amerika. "YoY" (Year-over-Year) artinya dibandingin sama setahun lalu. Lagi tumbuh LEBIH LAMBAT (atau nyusut) dari biasanya -- likuiditas di sistem keuangan lagi mengetat, biasanya kurang menguntungkan buat aset berisiko.',
  },
  stablecoinGrowth: {
    above: 'Stablecoin (USDT/USDC dkk) itu "peluru" yang disiapin orang buat beli crypto. Total beredarnya tumbuh LEBIH CEPAT dari biasanya seminggu terakhir -- bisa berarti banyak orang lagi nyiapin duit buat masuk pasar crypto (cenderung bullish, bukan jaminan).',
    below: 'Stablecoin (USDT/USDC dkk) itu "peluru" yang disiapin orang buat beli crypto. Pertumbuhannya lebih LAMBAT/nyusut dari biasanya -- bisa berarti minat/duit yang masuk ke ekosistem crypto lagi berkurang.',
  },
  cotNetPct: {
    above: '"COT" (Commitments of Traders) itu laporan RESMI mingguan dari regulator pasar futures Amerika (CFTC) -- BUKAN singkatan yang lain, isinya nunjukin institusi besar (bank, hedge fund) lagi pasang posisi LONG (percaya harga naik) di futures Emas, lebih banyak dari biasanya. Emas & BTC kadang gerak MIRIP (sama-sama dianggap "aset lindung nilai") -- ini konteks sentimen makro besar, bukan sinyal langsung ke BTC.',
    below: '"COT" (Commitments of Traders) itu laporan RESMI mingguan dari regulator pasar futures Amerika (CFTC), isinya nunjukin institusi besar (bank, hedge fund) lagi ngurangin posisi LONG di futures Emas, lebih dari biasanya. Emas & BTC kadang gerak mirip -- ini konteks sentimen makro besar, bukan sinyal langsung ke BTC.',
  },
  btcNasdaqCorr: {
    above: 'Ini ngukur seberapa MIRIP gerakan harga BTC sama indeks saham teknologi Nasdaq belakangan ini. Lagi TINGGI banget dari biasanya -- BTC lagi "nempel" ke saham teknologi, berita ekonomi Amerika/suku bunga jadi LEBIH RELEVAN buat BTC drpd berita crypto sendiri.',
    below: 'Ini ngukur seberapa MIRIP gerakan harga BTC sama indeks saham teknologi Nasdaq belakangan ini. Lagi RENDAH banget dari biasanya -- BTC lagi "jalan sendiri", gak terlalu kepengaruh naik-turunnya saham Amerika.',
  },
  goldDxyCorr: {
    above: 'Emas biasanya gerak KEBALIKAN dari Dollar Index (DXY) -- dolar naik, emas turun (dan sebaliknya). Hubungan kebalikan ini lagi LEBIH KUAT dari biasanya sekarang.',
    below: 'Emas biasanya gerak KEBALIKAN dari Dollar Index (DXY). Hubungan ini lagi MELEMAH/berubah dari biasanya -- ada faktor LAIN (geopolitik, permintaan fisik, dll) yang lagi lebih dominan gerakin harga emas drpd sekadar dolar.',
  },
  whaleVolumeBtc: {
    above: 'Ini total BTC yang "pindah tangan" dalam transaksi RAKSASA (di atas 1000 BTC/transaksi) hari ini. Jumlahnya LEBIH BANYAK dari kebiasaan kita -- bisa berarti exchange/institusi besar lagi mindahin dana gede (rebalancing, pindah cold wallet, atau beneran whale beraksi). BUKAN otomatis berarti jual/beli -- banyak transaksi segede ini cuma pindah dari 1 dompet ke dompet LAIN milik orang yang SAMA.',
    below: 'Ini total BTC yang "pindah tangan" dalam transaksi RAKSASA (di atas 1000 BTC/transaksi) hari ini. Jumlahnya LEBIH SEDIKIT dari kebiasaan kita -- pasar lagi sepi dari pergerakan dana gede, gak ada yang perlu dikhawatirkan.',
  },
  whaleTxCount: {
    above: 'Ini ngitung BERAPA KALI ada transaksi raksasa (>=1000 BTC) hari ini. Lebih SERING dari biasanya -- banyak pihak besar gerak bareng dalam waktu singkat, kadang nemenin naiknya volatilitas harga.',
    below: 'Ini ngitung BERAPA KALI ada transaksi raksasa (>=1000 BTC) hari ini. Lebih JARANG dari biasanya -- lagi sepi aktivitas whale.',
  },
  whaleToExchangeBtc: {
    above: 'Ini total BTC yang KETAHUAN masuk ke dompet exchange besar (Binance/Kraken/Bitstamp dkk) hari ini, dalam transaksi RAKSASA. Jumlahnya JAUH LEBIH BANYAK dari biasanya -- ini pola yang biasa diartikan "siap-siap jual": duit gede lagi didaratin ke exchange, langkah SEBELUM biasanya dijual. BUKAN kepastian (bisa juga cuma pindah/rebalancing internal), tapi worth diwaspadai.',
    below: 'Ini total BTC yang KETAHUAN masuk ke dompet exchange besar hari ini. Jumlahnya LEBIH SEDIKIT dari biasanya -- gak ada tanda persiapan jual besar-besaran dari data ini.',
  },
  whaleFromExchangeBtc: {
    above: 'Ini total BTC yang KETAHUAN keluar dari dompet exchange besar (Binance/Kraken/Bitstamp dkk) hari ini, dalam transaksi RAKSASA. Jumlahnya JAUH LEBIH BANYAK dari biasanya -- ini pola yang biasa diartikan "siap-siap bull": duit gede lagi DITARIK KELUAR dari exchange, biasanya buat disimpen jangka panjang (gak dijual dalam waktu dekat). BUKAN kepastian, tapi ini sinyal AKUMULASI yang cukup dipercaya di kalangan analis on-chain.',
    below: 'Ini total BTC yang KETAHUAN keluar dari dompet exchange besar hari ini. Jumlahnya LEBIH SEDIKIT dari biasanya -- gak ada tanda akumulasi besar-besaran dari data ini.',
  },
};

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[AnomalyScanner] ${label} gagal diambil (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

async function collectTodayValues() {
  const [advancedMacro, cot, btcRegime, goldRegime] = await Promise.all([
    safe(fetchAdvancedMacroContext, 'Advanced Macro'),
    safe(fetchGoldCotContext, 'COT'),
    safe(fetchBtcNasdaqRegime, 'BTC-Nasdaq Regime'),
    safe(fetchGoldDxyRegime, 'Emas-DXY Regime'),
  ]);

  const values = {};
  if (advancedMacro?.dvol) values.dvol = advancedMacro.dvol.value;
  if (advancedMacro?.fedRate) values.fedRate = advancedMacro.fedRate.value;
  if (advancedMacro?.creditSpread) values.creditSpread = advancedMacro.creditSpread.value;
  if (advancedMacro?.yieldCurve) values.yieldCurve = advancedMacro.yieldCurve.value;
  if (advancedMacro?.m2?.changePctYoY != null) values.m2YoY = advancedMacro.m2.changePctYoY;
  if (advancedMacro?.stablecoin?.changePct != null) values.stablecoinGrowth = advancedMacro.stablecoin.changePct;
  if (cot) values.cotNetPct = cot.netPctOi;
  if (btcRegime) values.btcNasdaqCorr = btcRegime.corr90;
  if (goldRegime) values.goldDxyCorr = goldRegime.corr90;

  // 12 Sep 2026, permintaan Olan ("whale alert lebih pintar atau hapus aja") -- whaleDailyDigest.js
  // SEKARANG cuma nulis total harian ke whale-state.json (gak kirim WA sendiri lagi, lihat file
  // itu), dibaca di sini biar ikut sistem anomali yang SAMA (diem kalau normal, ngomong kalau
  // beneran beda dari kebiasaan) -- ganti dari "kirim rekap tiap hari apapun isinya" yang
  // kebanyakan "gak teridentifikasi" doang (daftar alamat exchange kita emang sangat terbatas).
  try {
    if (fs.existsSync(WHALE_STATE_PATH)) {
      const whaleState = JSON.parse(fs.readFileSync(WHALE_STATE_PATH, 'utf8'));
      if (whaleState.lastDigest && whaleState.lastDigest.dateKey === localDateKey(new Date())) {
        values.whaleVolumeBtc = whaleState.lastDigest.totalBtc;
        values.whaleTxCount = whaleState.lastDigest.count;
        // 12 Sep 2026, permintaan Olan ("kalo masuk exchange kan ngerti wah ini bakal sale..
        // kalo keluar dari exchange.. siap siap bull") -- SEKARANG dipisah jadi 2 indikator arah,
        // biar sistem anomali bisa nangkep KALAU salah satu arah ekstrem beda dari kebiasaan,
        // bukan cuma total keseluruhan gabungan.
        if (whaleState.lastDigest.toExchangeBtc != null) values.whaleToExchangeBtc = whaleState.lastDigest.toExchangeBtc;
        if (whaleState.lastDigest.fromExchangeBtc != null) values.whaleFromExchangeBtc = whaleState.lastDigest.fromExchangeBtc;
      }
    }
  } catch (e) {
    console.log('[AnomalyScanner] Gagal baca whale-state.json (dilewatin):', e.message);
  }

  return values;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { history: {}, lastFlagged: {} };
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!s.history) s.history = {};
  if (!s.lastFlagged) s.lastFlagged = {};
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Robust z-score: (nilai - median) / (MAD * 1.4826) -- konstanta 1.4826 nyamain skala MAD ke
// setara standard deviation buat distribusi normal, konvensi statistik baku.
function robustZScore(value, history) {
  const med = median(history);
  const mad = median(history.map((x) => Math.abs(x - med)));
  if (mad === 0) return 0;
  return (value - med) / (mad * 1.4826);
}

function formatAnomalyData(key, value, z, history) {
  const label = TRACKED_LABELS[key] || key;
  const med = median(history);
  const arah = z > 0 ? 'JAUH DI ATAS' : 'JAUH DI BAWAH';
  return `${label}: ${value.toFixed(2)} -- ${arah} kebiasaan historis kita (median ${med.toFixed(2)}, z-score ${z.toFixed(1)})`;
}

// 12 Sep 2026, permintaan Olan ("boleh kirim 2 pesan.. pesan pertama data, pesan kedua
// penjelasan.. anggap pembaca gak tau apa-apa jadi ooo gitu paham") -- pesan TERPISAH khusus
// penjelasan awam, biar pesan data (ringkas, buat yang udah paham) gak numpuk kepanjangan.
function formatAnomalyExplanation(key, z) {
  const label = TRACKED_LABELS[key] || key;
  const exp = EXPLANATIONS[key];
  const text = exp ? (z > 0 ? exp.above : exp.below) : 'Belum ada penjelasan awam buat indikator ini.';
  return `${label}\n${text}`;
}

async function main() {
  const now = new Date();
  const state = loadState();
  const todayValues = await collectTodayValues();

  const anomalies = [];
  for (const [key, value] of Object.entries(todayValues)) {
    if (!state.history[key]) state.history[key] = [];
    const hist = state.history[key];

    if (hist.length >= MIN_HISTORY) {
      const z = robustZScore(value, hist.map((h) => h.v));
      if (Math.abs(z) >= Z_THRESHOLD) {
        const lastFlag = state.lastFlagged[key];
        const cooldownOk = !lastFlag || now.getTime() - new Date(lastFlag).getTime() > COOLDOWN_MS;
        if (cooldownOk) {
          anomalies.push({ key, value, z, historyValues: hist.map((h) => h.v) });
          state.lastFlagged[key] = now.toISOString();
        }
      }
    }

    hist.push({ date: now.toISOString(), v: value });
    state.history[key] = hist.slice(-MAX_HISTORY);
  }

  saveState(state);

  if (anomalies.length === 0) {
    console.log(`[AnomalyScanner] ${now.toISOString()} -- normal, gak ada anomali (histori: ${Object.entries(state.history).map(([k, v]) => `${k}=${v.length}`).join(', ')}).`);
    return;
  }

  const dataMsg = [
    `${CATEGORY_COLOR.laporan.emoji} 🔍 KAELA ANOMALY SCANNER`,
    '',
    `Ditemukan ${anomalies.length} indikator lagi gak biasa dibanding histori kita sendiri:`,
    '',
    ...anomalies.map((a) => formatAnomalyData(a.key, a.value, a.z, a.historyValues)),
    '',
    '⚠️ Ini deteksi STATISTIK murni (z-score vs histori kita), BUKAN backtest sinyal Sniper/Musiman -- level keyakinannya beda, murni radar "ada yang aneh, cek lebih lanjut".',
    '',
    `🔗 ${WEB_URL}/analis.html`,
  ].join('\n');

  // 12 Sep 2026, permintaan Olan -- pesan KEDUA terpisah, khusus penjelasan awam ("anggap
  // pembaca gak tau apa-apa jadi ooo gitu paham"). Dipisah dari pesan data biar yang udah paham
  // gak perlu scroll lewatin paragraf, yang belum paham dapet penjelasan lengkap tanpa pesan
  // data jadi kepanjangan/berantakan.
  const explainMsg = `${CATEGORY_COLOR.laporan.emoji} 📖 PENJELASAN\n\n`
    + anomalies.map((a) => formatAnomalyExplanation(a.key, a.z)).join('\n\n');

  console.log(dataMsg + '\n\n' + explainMsg);
  addEntry('anomaly', dataMsg + '\n\n' + explainMsg, now);
  await sendWhatsApp(dataMsg);
  await sendWhatsApp(explainMsg);
}

module.exports = { formatAnomalyData, formatAnomalyExplanation, collectTodayValues };

if (require.main === module) main().catch((e) => {
  console.error('ERROR anomalyScanner.js:', e.message);
  process.exit(1);
});
