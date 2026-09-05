// Format pesan Jadwal Ekonomi -- MURNI INFORMASI (sama kayak Kaela News), gak pengaruhi sinyal.

const { WEB_URL, localDateKey } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

const ARAH_LABEL = { tertekan: '📉 BTC cenderung TERTEKAN', menguat: '📈 BTC cenderung MENGUAT', campuran: '↔️ Efek CAMPURAN, gak konsisten' };

// Baris perkiraan arah (11 Agu 2026, permintaan Olan: "berani memperkirakan arah, jelasin
// kalau begini maka begitu") -- heuristik makro standar (channel ekspektasi The Fed
// hawkish/dovish), BUKAN backtest data historis kayak sinyal Sniper/Musiman. `strength`
// ditampilkan biar jujur soal seberapa reliable hubungannya -- gak semua event sama kuat.
function directionalLines(e) {
  const v = e.directionalView;
  if (!v) return ['   (belum ada peta sebab-akibat buat event ini -- gak dipaksa nebak)'];
  if (v.aboveForecast === null) {
    return [`   📐 ${v.label} (keyakinan: ${v.strength}) -- ${v.mechanism}`];
  }
  return [
    `   📐 ${v.label} (keyakinan: ${v.strength}):`,
    `      • Kalau ACTUAL > forecast -> ${ARAH_LABEL[v.aboveForecast] || v.aboveForecast}`,
    `      • Kalau ACTUAL < forecast -> ${ARAH_LABEL[v.belowForecast] || v.belowForecast}`,
  ];
}

// Label hari relatif ke `now` -- "HARI INI"/"BESOK"/tanggal biasa (event bisa jatuh lebih dari
// 1 hari ke depan karena window sekarang 48 jam, bukan cuma hari kalender ini lagi).
function dayLabel(dateKey, now) {
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (dateKey === todayKey) return 'HARI INI';
  if (dateKey === tomorrowKey) return 'BESOK';
  return dateKey;
}

function formatEconCalendar(now, events) {
  const lines = [];
  lines.push(`${CATEGORY_COLOR.econ.emoji} 📅 JADWAL EKONOMI MENDATANG (peringatan dini)`);
  lines.push('(event USD dampak tinggi dalam 48 jam ke depan -- paling relevan buat BTC lewat sentimen risiko)');
  lines.push('');
  for (const e of events) {
    lines.push(`🕐 ${dayLabel(e.dateKey, now)}, ${e.time} WITA — ${e.title}`);
    lines.push(`   Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`);
    lines.push(...directionalLines(e));
    lines.push('');
  }
  lines.push('⚠️ Perkiraan arah di atas itu LOGIKA MAKRO UMUM (sebab-akibat standar), BUKAN backtest data historis kayak sinyal Sniper/Musiman -- level keyakinannya beda, jangan disamakan. Murni informasi -- gak pengaruhi sinyal Sniper atau keputusan Musim Tanam/Panen.');
  lines.push('');
  lines.push(`🔗 ${WEB_URL}`);
  return lines.join('\n');
}

// 5 Sep 2026, permintaan Olan ("detektor tiap 5 menit.. 5 menit sebelum kasih info siap-siap
// high impact, 5 menit sesudah simpulkan intinya hawkish/dovish") -- dipake econCalendarLiveMonitor.js.

function formatHeadsUp(e) {
  const lines = [
    `${CATEGORY_COLOR.econ.emoji} ⏰ SIAP-SIAP -- ${e.time} WITA (sebentar lagi)`,
    e.title,
    `Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`,
    ...directionalLines(e),
    '',
    'High-impact -- pantau reaksi pasar (DXY/BTC) sebentar lagi.',
  ];
  return lines.join('\n');
}

// Parser angka ForexFactory ("3.2%", "150K", "-0.3%", "2.1M", dst) -- MINUS tetep dijaga (regex
// digit-doang bakal ngilangin tanda minus kalau gak dipisah eksplisit kayak gini).
function parseEconNumber(raw) {
  if (!raw || raw === '-') return null;
  const str = String(raw).trim();
  const isNeg = /^-/.test(str) || /^\(.*\)$/.test(str);
  const m = str.match(/[\d.]+/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (isNaN(n)) return null;
  if (/K/i.test(str)) n *= 1e3;
  else if (/M/i.test(str)) n *= 1e6;
  else if (/B/i.test(str)) n *= 1e9;
  return isNeg ? -n : n;
}

const HAWKISH_DOVISH_LABEL = { tertekan: 'HAWKISH 📉', menguat: 'DOVISH 📈', campuran: 'CAMPURAN ↔️' };

// 5 Sep 2026, permintaan Olan ("saat ada high impact wajib deteksi DXY 5 menit sebelum dan
// sesudahnya") -- reaksi DXY BENERAN (bukan cuma teori mekanisme) di jendela SEMPIT sekitar rilis.
// Threshold lebih KETAT (0.15%) drpd classifyDxyTrend di macroData.js (0.3%, buat perbandingan
// HARIAN) -- ini jendela ~10-15 menit doang, gerakan sekecil itu udah cukup berarti buat window
// sesempit itu. Ini JUGA satu-satunya sinyal yang kebaca buat event KUALITATIF (FOMC Statement dst,
// gak ada angka forecast/actual buat dibandingin) -- pasar yang "ngomong" duluan lewat DXY.
function classifyDxyReaction(changePct) {
  if (changePct == null) return null;
  if (changePct > 0.15) return { label: 'HAWKISH 📉', desc: 'dolar menguat' };
  if (changePct < -0.15) return { label: 'DOVISH 📈', desc: 'dolar melemah' };
  return { label: 'NETRAL ↔️', desc: 'dolar gak banyak gerak' };
}
function dxyReactionNote(changePct) {
  if (changePct == null) return null;
  const sign = changePct >= 0 ? '+' : '';
  const r = classifyDxyReaction(changePct);
  return `DXY bereaksi ${sign}${changePct.toFixed(2)}% dalam ~10 menit sekitar rilis ini -- ${r.desc}.`;
}

// Simpulin hawkish/dovish dari actual vs forecast, pakai peta sebab-akibat yang UDAH ADA
// (econDirectionalView.js) -- 'tertekan' (BTC biasanya tertekan) SELALU berpadanan sama HAWKISH,
// 'menguat' SELALU sama DOVISH di SEMUA kategori yang udah dipetain (lihat mechanism masing-masing
// kategori, semua eksplisit framing "-> hawkish -> tertekan" / "-> dovish -> diuntungkan").
// `dxyChangePct` (opsional, null kalau gagal ambil/gak ada snapshot "sebelum") -- BUAT EVENT
// KUALITATIF (FOMC dst, v.aboveForecast === null) ini SATU-SATUNYA sumber kesimpulan, buat event
// NUMERIK ditampilin BARENGAN kesimpulan dari angka (2 sinyal, konfirmasi satu sama lain).
function concludeHawkishDovish(e, dxyChangePct) {
  const v = e.directionalView;
  const dxyR = classifyDxyReaction(dxyChangePct);
  const dxyNote = dxyReactionNote(dxyChangePct);

  if (!v) return { label: dxyR ? dxyR.label : null, note: [dxyNote, 'Belum ada peta sebab-akibat buat event ini dari sisi angka.'].filter(Boolean).join(' ') };

  if (v.aboveForecast === null) {
    return {
      label: dxyR ? dxyR.label : null,
      note: dxyNote || 'Event kualitatif (nada pernyataan) -- gak ada angka DAN reaksi DXY gak kebaca, gak bisa disimpulkan otomatis.',
    };
  }
  const a = parseEconNumber(e.actual), f = parseEconNumber(e.forecast);
  if (a === null || f === null) return { label: dxyR ? dxyR.label : null, note: [dxyNote, 'Angka actual/forecast gak kebaca -- gak bisa dibandingin otomatis.'].filter(Boolean).join(' ') };
  if (a === f) return { label: 'NETRAL ↔️', note: ['Persis sesuai ekspektasi -- dampak biasanya minim.', dxyNote].filter(Boolean).join(' ') };
  const result = a > f ? v.aboveForecast : v.belowForecast;
  return { label: HAWKISH_DOVISH_LABEL[result] || String(result).toUpperCase(), note: [v.mechanism, dxyNote].filter(Boolean).join(' ') };
}

function formatResult(e, dxyChangePct) {
  const c = concludeHawkishDovish(e, dxyChangePct);
  const lines = [
    `${CATEGORY_COLOR.econ.emoji} 📊 HASIL RILIS -- ${e.title}`,
    `Actual: ${e.actual || '-'} | Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`,
  ];
  if (c.label) lines.push(`🧭 Kesimpulan: ${c.label}`);
  lines.push(`   ${c.note}`);
  lines.push('');
  lines.push('⚠️ Logika makro umum + reaksi DXY jendela sempit, BUKAN backtest data historis -- murni informasi, gak pengaruhi sinyal Sniper/Musiman.');
  return lines.join('\n');
}

module.exports = { formatEconCalendar, formatHeadsUp, formatResult, concludeHawkishDovish, parseEconNumber, classifyDxyReaction };

if (require.main === module) {
  const example = [
    { title: 'Non-Farm Employment Change', dateKey: localDateKey(new Date()), time: '20:30', forecast: '85K', previous: '57K' },
    { title: 'Unemployment Rate', dateKey: localDateKey(new Date()), time: '20:30', forecast: '4.2%', previous: '4.2%' },
  ];
  console.log(formatEconCalendar(new Date(), example));
}
