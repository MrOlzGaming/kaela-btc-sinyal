// Track record Kaela Conviction Score -- catat tiap verdict yang dikirim, nilai balik akurasinya
// setelah cukup waktu berlalu, biar kredibilitas Kaela dibangun dari REKAM JEJAK TERUKUR, bukan
// cuma "kelihatan pintar". 22 Agu 2026 -- lapisan PENUTUP "Kaela analis tier Bloomberg" (lihat
// memori project-kaela-analyst-tier).
//
// Cara kerja: tiap Conviction Score mingguan DICATAT (skor, verdict, harga saat itu). Setelah
// MATURITY_DAYS berlalu, verdict itu DINILAI -- dibandingin arah verdict (bullish/bearish) sama
// arah harga BENERAN (naik/turun) sejak saat itu. Verdict NETRAL sengaja DIKECUALIKAN dari win
// rate (itu bukan "panggilan arah", gak adil dinilai benar/salah).

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'conviction-track-record.json');
const MATURITY_DAYS = 7; // dinilai setelah verdict mingguan berikutnya (siklus mingguan = 7 hari)
const NEUTRAL_MOVE_THRESHOLD_PCT = 1; // gerakan harga <1% dianggap "gak kemana-mana", verdict directional dianggap meleset kalau harga malah lawan arah, TAPI gerakan <1% searah pun tetap dihitung benar (threshold cuma buat nentuin arah aktual, bukan buat toleransi salah)

function loadRecords() {
  if (!fs.existsSync(STATE_PATH)) return [];
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveRecords(records) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(records, null, 2));
}

// verdictDirection: 'bullish' | 'bearish' | 'netral' -- dari label verdictLabel() convictionScore.js
function verdictDirection(verdictLabelStr) {
  if (verdictLabelStr.includes('Bullish') || verdictLabelStr.includes('BULLISH')) return 'bullish';
  if (verdictLabelStr.includes('Bearish') || verdictLabelStr.includes('BEARISH')) return 'bearish';
  return 'netral';
}

function logVerdict(asset, now, score, verdictLabelStr, price) {
  const records = loadRecords();
  records.push({
    asset, date: now.toISOString(), score, verdict: verdictLabelStr,
    direction: verdictDirection(verdictLabelStr), priceAtVerdict: price,
    graded: false, actualDirection: null, correct: null,
  });
  saveRecords(records);
}

// Nilai semua verdict yang UDAH CUKUP UMUR (>=MATURITY_DAYS) dan belum dinilai -- `currentPrices`
// = { btc: number, xau: number } harga SEKARANG buat aset yang mau dinilai.
function gradeMaturedVerdicts(now, currentPrices) {
  const records = loadRecords();
  let gradedCount = 0;
  for (const r of records) {
    if (r.graded) continue;
    const ageDays = (now.getTime() - new Date(r.date).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < MATURITY_DAYS) continue;
    const currentPrice = currentPrices[r.asset];
    if (currentPrice == null) continue; // harga sekarang gak ada, tunda nilai (dicoba lagi run berikutnya)

    const changePct = ((currentPrice - r.priceAtVerdict) / r.priceAtVerdict) * 100;
    r.actualDirection = changePct > NEUTRAL_MOVE_THRESHOLD_PCT ? 'naik' : changePct < -NEUTRAL_MOVE_THRESHOLD_PCT ? 'turun' : 'datar';
    r.actualChangePct = changePct;
    r.graded = true;
    if (r.direction === 'netral') {
      r.correct = null; // dikecualikan dari win rate, bukan salah/benar
    } else {
      r.correct = (r.direction === 'bullish' && changePct > 0) || (r.direction === 'bearish' && changePct < 0);
    }
    gradedCount++;
  }
  if (gradedCount > 0) saveRecords(records);
  return gradedCount;
}

function getTrackRecordSummary(asset) {
  const records = loadRecords().filter((r) => r.asset === asset && r.graded && r.correct !== null);
  if (records.length === 0) return null;
  const correct = records.filter((r) => r.correct).length;
  return { total: records.length, correct, winRatePct: (correct / records.length) * 100 };
}

function formatTrackRecordLine(asset) {
  const s = getTrackRecordSummary(asset);
  if (!s) return '📈 Track Record: belum cukup data (verdict pertama butuh 7 hari buat dinilai)';
  return `📈 Track Record Conviction Score: ${s.correct}/${s.total} verdict tepat arah (${s.winRatePct.toFixed(0)}%) -- dari verdict yang udah cukup umur dinilai (7+ hari, verdict netral dikecualikan)`;
}

module.exports = { logVerdict, gradeMaturedVerdicts, getTrackRecordSummary, formatTrackRecordLine, MATURITY_DAYS };
