// On-chain metrics BTC (9 Agu 2026) -- MVRV, SOPR, NUPL, Puell Multiple. Sumber: bitcoin-data.com,
// GRATIS, no API key -- TAPI limit 10 request/jam. Data sumbernya sendiri cuma update 1x/hari
// (nilai yang ditarik "hari ini" biasanya masih tanggal KEMARIN, butuh waktu settle blockchain) --
// makanya modul ini WAJIB dipanggil paling banyak 1x/hari per proses (Laporan Harian Halving +
// Nyopet Auto-Analysis), JANGAN pernah dipasang ke workflow yang jalan tiap jam/menit
// (whale-alert/price-alert/nyopet-hourly) -- limitnya abis dalam hitungan menit kalau dipaksa.

const BASE_URL = 'https://bitcoin-data.com/v1';

// SENGAJA plain fetch() TANPA retry -- limit sumber ini ketat (10/jam). Kalau kena 429
// (rate limit), retry PASTI gagal lagi dalam jam yang sama, cuma buang-buang jatah quota yang
// udah mepet. Gagal 1x = skip metrik itu hari ini (via safe() di bawah), gak fatal.
async function fetchLast(metric) {
  const res = await fetch(`${BASE_URL}/${metric}/last`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  return res.json();
}

async function safe(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[OnchainMetrics] ${label} gagal (dilewatin):`, e.message.slice(0, 120));
    return null;
  }
}

// Batas klasifikasi -- dari konvensi umum analis on-chain (Glassnode dkk), BUKAN Kaela ngarang:
// MVRV >3.5 histori zona puncak siklus, <1 zona capitulation/bottom.
function classifyMvrv(v) {
  if (v < 1) return 'Undervalued / capitulation';
  if (v < 2) return 'Fair value / akumulasi';
  if (v < 3.5) return 'Normal bull';
  return 'Overvalued -- historis zona puncak siklus';
}

// NUPL: skala baku Glassnode.
function classifyNupl(v) {
  if (v < 0) return 'Capitulation';
  if (v < 0.25) return 'Hope / Fear';
  if (v < 0.5) return 'Optimism / Anxiety';
  if (v < 0.75) return 'Belief / Denial';
  return 'Euphoria / Greed';
}

// SOPR: >1 rata-rata jual untung, <1 rata-rata jual rugi, ~1 breakeven (sering jadi level
// support/resistance psikologis pas market lagi trending).
function classifySopr(v) {
  if (v > 1.02) return 'Rata-rata jual UNTUNG';
  if (v < 0.98) return 'Rata-rata jual RUGI';
  return 'Breakeven (~1.0)';
}

// Puell Multiple: <0.5 histori zona bottom kuat (miner capitulation), >4 histori zona euforia/puncak.
function classifyPuell(v) {
  if (v < 0.5) return 'Rendah -- histori zona akumulasi/bottom kuat';
  if (v < 4) return 'Normal';
  return 'Tinggi -- histori zona euforia/puncak siklus';
}

async function fetchMvrv() {
  const d = await fetchLast('mvrv');
  return { value: d.mvrv, date: d.d, classification: classifyMvrv(d.mvrv) };
}
async function fetchSopr() {
  const d = await fetchLast('sopr');
  return { value: d.sopr, date: d.d, classification: classifySopr(d.sopr) };
}
async function fetchNupl() {
  const d = await fetchLast('nupl');
  return { value: d.nupl, date: d.d, classification: classifyNupl(d.nupl) };
}
async function fetchPuellMultiple() {
  const d = await fetchLast('puell-multiple');
  return { value: d.puellMultiple, date: d.d, classification: classifyPuell(d.puellMultiple) };
}

// Buat Laporan Harian Siklus Halving -- MVRV + Puell (paling relevan buat posisi di siklus 4 tahun).
async function fetchCycleMetrics() {
  const [mvrv, puellMultiple] = await Promise.all([
    safe(fetchMvrv, 'MVRV'),
    safe(fetchPuellMultiple, 'Puell Multiple'),
  ]);
  return { mvrv, puellMultiple };
}

// Buat Nyopet Auto-Analysis -- SOPR + NUPL (lebih pas buat konteks jangka pendek-menengah).
async function fetchTradeMetrics() {
  const [sopr, nupl] = await Promise.all([
    safe(fetchSopr, 'SOPR'),
    safe(fetchNupl, 'NUPL'),
  ]);
  return { sopr, nupl };
}

module.exports = {
  fetchMvrv, fetchSopr, fetchNupl, fetchPuellMultiple, fetchCycleMetrics, fetchTradeMetrics,
};

if (require.main === module) {
  (async () => {
    console.log('Cycle (Halving):', JSON.stringify(await fetchCycleMetrics(), null, 2));
    console.log('Trade (Nyopet):', JSON.stringify(await fetchTradeMetrics(), null, 2));
  })();
}
