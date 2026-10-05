// Format pesan Jadwal Ekonomi -- MURNI INFORMASI (sama kayak Kaela News), gak pengaruhi sinyal.

const { WEB_URL, localDateKey, toLocal } = require('./config');
const { CATEGORY_COLOR } = require('./categoryColors');

// ====== Format baru pesan JADWAL & SIAP-SIAP (5 Okt 2026, permintaan Olan: "tulis lebih rapi, review & kritik sendiri") ======
// Kritik versi lama: header + disclaimer panjang diulang tiap pesan, "(keyakinan: sedang):" numpuk kurung, legenda 3 level
// nongol terus (padahal tiap event udah ada levelnya), nama event cuma terjemahan (gak ada nama asli/kepanjangan/arti), angka
// pakai titik desimal ala Inggris, event jam sama dikirim terpisah. Versi baru: 1 blok rapi per event (nama asli -> kepanjangan
// -> arti -> level -> angka -> arah BTC), event jam sama digabung, disclaimer 1 baris.

const ARAH_SINGKAT = { tertekan: '📉 BTC cenderung tertekan', menguat: '📈 BTC cenderung menguat', campuran: '↔️ efek ke BTC campuran' };
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const GARIS = '━━━━━━━━━━━━';

// angka ForexFactory "55.1" / "0.3%" / "225K" -> desimal koma ala Indonesia
const fmtNum = (v) => (v == null || v === '' || v === '-' ? null : String(v).replace(/(\d)\.(\d)/g, '$1,$2'));

// "Senin, 5 Okt (hari ini)"
function dayLabel(e, now) {
  const d = toLocal(new Date(e.timeMs));
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const rel = e.dateKey === todayKey ? ' (hari ini)' : e.dateKey === tomorrowKey ? ' (besok)' : '';
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}${rel}`;
}

function directionalLines(e) {
  const v = e.directionalView;
  if (!v) return ['Arah BTC: belum dipetakan (gak dipaksa nebak)'];
  const head = `Arah BTC (logika makro, keyakinan ${v.strength}):`;
  if (v.aboveForecast === null) return ['Arah BTC (dari nada omongan):', '• Nada galak/hawkish → 📉 BTC cenderung tertekan', '• Nada lunak/dovish → 📈 BTC cenderung menguat'];
  if (v.aboveForecast === 'campuran' && v.belowForecast === 'campuran') return [head, '• Efek ke BTC campuran -- gak dipaksa 1 arah'];
  return [head, `• Di atas perkiraan → ${ARAH_SINGKAT[v.aboveForecast] || v.aboveForecast}`, `• Di bawah perkiraan → ${ARAH_SINGKAT[v.belowForecast] || v.belowForecast}`];
}

// 1 blok event: nama asli -> kepanjangan -> arti -> level -> angka -> arah
function eventBlock(e) {
  const lines = [`📰 *${e.rawTitle || e.title}*`];
  if (e.glossary) lines.push(`🇺🇸 ${e.glossary.inggris}`, `🇮🇩 ${e.glossary.arti}`);
  else if (e.title && e.title !== e.rawTitle) lines.push(`🇮🇩 ${e.title}`);
  if (e.impactLevel) lines.push(`Level: ${e.impactLevel.badge}`);
  const fc = fmtNum(e.forecast), prev = fmtNum(e.previous);
  if (fc || prev) lines.push(`Perkiraan: ${fc || '-'} · Sebelumnya: ${prev || '-'}`);
  lines.push(...directionalLines(e));
  return lines;
}

// kelompokin event yang jamnya PERSIS sama (rilis barengan) -> [{ timeMs, events }] urut waktu
function groupByTime(events) {
  const map = new Map();
  for (const e of events) { if (!map.has(e.timeMs)) map.set(e.timeMs, []); map.get(e.timeMs).push(e); }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([timeMs, evs]) => ({ timeMs, events: evs }));
}

const DISCLAIMER = 'ℹ️ Arah BTC = logika makro umum, BUKAN hasil backtest. Murni info, gak ngubah sinyal Kaela.';

function formatEconCalendar(now, events) {
  const lines = [`${CATEGORY_COLOR.econ.emoji} 📅 *JADWAL BERITA EKONOMI AS*`, 'Peringatan dini · 48 jam ke depan'];
  for (const g of groupByTime(events)) {
    lines.push('', GARIS, `🕐 ${dayLabel(g.events[0], now)} · ${g.events[0].time} WITA`);
    g.events.forEach((e, i) => { lines.push(...(i ? [''] : []), ...eventBlock(e)); });
  }
  lines.push(GARIS, '', DISCLAIMER, '', `🔗 ${WEB_URL}`);
  return lines.join('\n');
}

// 5 Sep 2026 -- dipake econCalendarLiveMonitor.js ~5 menit sebelum rilis. 5 Okt 2026: terima 1 event ATAU array event
// yang rilis barengan (digabung 1 pesan), + extraLines dari pemanggil (mis. status Ninja News).
function formatHeadsUp(eventOrList, extraLines = []) {
  const events = Array.isArray(eventOrList) ? eventOrList : [eventOrList];
  const lines = [`${CATEGORY_COLOR.econ.emoji} ⏰ *SIAP-SIAP · 5 menit lagi*`, `🕐 ${events[0].time} WITA`];
  events.forEach((e) => { lines.push('', ...eventBlock(e)); });
  if (events.some((e) => e.impactLevel && e.impactLevel.key === 'raja')) {
    lines.push('', '👑 FINAL BOSS -- BTC bisa gerak liar beberapa persen dalam hitungan menit. Jangan buka posisi manual pas rilis.');
  }
  if (extraLines.length) lines.push('', ...extraLines);
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
// ⛔ BUG NYATA ketemu+fix 12 Sep 2026 (Olan: "cek riwayat kalo ga hari ini kemarin, hasilnya
// netral terus.. itu buat salah paham") -- root cause DIBUKTIKAN LANGSUNG (cek isi feed gratis
// nfs.faireconomy.media SAAT INI, event CPI/PPI yang UDAH RILIS kemarin): field `e.actual` SELALU
// kosong, feed gratis ini STRUKTURAL gak pernah ngisinya (bukan lag jaringan/bug kita). Akibatnya
// cabang "bandingin actual vs forecast" (paling akurat) GAK PERNAH jalan -- SELALU jatuh ke
// cadangan reaksi DXY 10 menit, yang SERING kebaca netral (window sesempit itu emang jarang cukup
// gerak). Masalahnya: label yang ditampilin ke Olan DULU nyamain "beneran netral" (DXY dianalisa,
// hasilnya genuinely datar) sama "data actual gak ada, ini cuma tebakan DXY seadanya" -- DUA
// MAKNA BEDA disamain jadi satu label "NETRAL ↔️" yang sama, bikin salah paham kesannya kesimpulan
// pasti padahal cuma fallback seadanya. Fix: kalau actual structural gak ada (`a === null`), label
// EKSPLISIT bilang "data belum ada" (BUKAN pura-pura "NETRAL"), reaksi DXY tetap disebut di note
// SEBAGAI KONTEKS TAMBAHAN (masih berguna), bukan lagi jadi LABEL UTAMA yang nyamar kayak
// kesimpulan pasti.
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
  if (a === null || f === null) {
    return {
      label: '❓ DATA ACTUAL BELUM ADA',
      note: [
        'Sumber data gratis kita belum ngasih angka rilis resmi (keterbatasan feed, bukan hasil analisa) -- kesimpulan hawkish/dovish akurat BELUM bisa dibuat.',
        dxyR ? `Sekadar konteks tambahan (BUKAN kesimpulan): reaksi DXY jendela sempit nunjukin ${dxyR.label} (${dxyR.desc}).` : null,
      ].filter(Boolean).join(' '),
    };
  }
  if (a === f) return { label: 'NETRAL ↔️', note: ['Persis sesuai ekspektasi -- dampak biasanya minim.', dxyNote].filter(Boolean).join(' ') };
  const result = a > f ? v.aboveForecast : v.belowForecast;
  return { label: HAWKISH_DOVISH_LABEL[result] || String(result).toUpperCase(), note: [v.mechanism, dxyNote].filter(Boolean).join(' ') };
}

// 12 Sep 2026, permintaan Olan ("sederhana kasih emot naik dollar / atau turun risk on asset") --
// baris ringkas 1 kalimat di atas penjelasan panjang, biar kebaca sekilas tanpa perlu mikir.
// Cuma ditampilin kalau kesimpulannya CUKUP YAKIN (HAWKISH/DOVISH/NETRAL beneran dari actual vs
// forecast) -- kalau masih "❓ DATA ACTUAL BELUM ADA" atau "CAMPURAN", sengaja GAK dipaksa nyimpulin.
function _simpleDollarRiskLine(label) {
  if (!label) return null;
  if (label.includes('HAWKISH')) return '💵📈 Simpel: Dollar cenderung NAIK -> 📉 aset risk-on (BTC dkk) cenderung tertekan';
  if (label.includes('DOVISH')) return '💵📉 Simpel: Dollar cenderung TURUN -> 📈 aset risk-on (BTC dkk) cenderung diuntungkan';
  if (label.includes('NETRAL')) return '💵↔️ Simpel: Dollar gak banyak gerak -> efek ke risk-on netral';
  return null;
}

function formatResult(e, dxyChangePct) {
  const c = concludeHawkishDovish(e, dxyChangePct);
  const lines = [
    `${CATEGORY_COLOR.econ.emoji} 📊 HASIL RILIS -- ${e.title}`,
    `Actual: ${e.actual || '-'} | Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`,
  ];
  if (c.label) lines.push(`🧭 Kesimpulan: ${c.label}`);
  const simple = _simpleDollarRiskLine(c.label);
  if (simple) lines.push(simple);
  lines.push(`   ${c.note}`);
  lines.push('');
  lines.push('⚠️ Logika makro umum + reaksi DXY jendela sempit, BUKAN backtest data historis -- murni informasi, gak pengaruhi sinyal Sniper/Musiman.');
  return lines.join('\n');
}

// 12 Sep 2026 -- pesan susulan KALAU actual masih kosong pas jendela hasil utama (5-15 menit)
// tapi kesedia belakangan (data telat dari provider, jarang tapi bisa kejadian -- lihat gap Okt
// 2025 di data BLS yang ketemu pas riset). Dipakai econCalendarLiveMonitor.js, jendela ke-2
// (~60 menit). SATU KALI doang, gak retry selamanya kalau tetep kosong.
function formatResultFollowup(e) {
  const c = concludeHawkishDovish(e, null);
  const lines = [
    `${CATEGORY_COLOR.econ.emoji} 📊 UPDATE HASIL (data susulan) -- ${e.title}`,
    `Actual: ${e.actual || '-'} | Forecast: ${e.forecast} | Sebelumnya: ${e.previous}`,
  ];
  if (c.label) lines.push(`🧭 Kesimpulan: ${c.label}`);
  const simple = _simpleDollarRiskLine(c.label);
  if (simple) lines.push(simple);
  lines.push(`   ${c.note}`);
  lines.push('');
  lines.push('ℹ️ Data resmi kesedia lebih lambat dari biasanya -- pesan hasil awal tadi belum ada angka actual-nya.');
  return lines.join('\n');
}

// 12 Sep 2026, permintaan Olan ("sekalian data hasil kalender ekonomi.. jika ada hasil maka
// jelasin dikit aja.. anggap pembaca gak tau apa-apa jadi ooo gitu paham") -- pesan KEDUA
// terpisah, singkat, khusus "apa ini & kenapa peduli" (beginnerWhy, econDirectionalView.js) --
// BEDA dari `c.note` di formatResult (yang lebih teknis/mekanisme actual-vs-forecast). Kalau
// event-nya belum ada peta directionalView sama sekali, gak dikirim (biar gak ngarang penjelasan).
function formatResultExplanation(e) {
  const v = e.directionalView;
  if (!v || !v.beginnerWhy) return null;
  return [
    `${CATEGORY_COLOR.econ.emoji} 📖 PENJELASAN`,
    '',
    e.title,
    v.beginnerWhy,
  ].join('\n');
}

module.exports = { formatEconCalendar, formatHeadsUp, formatResult, formatResultFollowup, formatResultExplanation, concludeHawkishDovish, parseEconNumber, classifyDxyReaction };

if (require.main === module) {
  const example = [
    { title: 'Non-Farm Employment Change', dateKey: localDateKey(new Date()), time: '20:30', forecast: '85K', previous: '57K' },
    { title: 'Unemployment Rate', dateKey: localDateKey(new Date()), time: '20:30', forecast: '4.2%', previous: '4.2%' },
  ];
  console.log(formatEconCalendar(new Date(), example));
}
