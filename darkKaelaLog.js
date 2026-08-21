// Format pesan Dark Kaela -- badge "[Dark] Kaela" + 🥷 (nyopet yang jahil/nyolong + dark yang
// misterius, permintaan Olan 15 Agu 2026: "emoticon yang sesuai... karena nyopet wkwkw dan dark").
// Cuma INFO, gak pernah eksekusi/rekomendasi keras -- disclaimer WAJIB lebih tegas dari Sniper
// (leverage jauh lebih agresif, ~100x/nyawa 1%).

// Link Liquidation Heat Map (15 Agu 2026, permintaan Olan -- lebih spesifik dari halaman
// LiquidationData biasa, langsung nampilin peta panas buat cek kelakuan candle di zona).
const COINGLASS_LINK = 'https://www.coinglass.com/pro/futures/LiquidationHeatMap';
const KALKULATOR_LINK = 'https://kaela-btc-sinyal.netlify.app/kalkulator.html';

function fmtUsd(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
}

function fmtWita(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' WITA';
}

function formatSignal(signal, now) {
  const dirLabel = signal.direction === 'long' ? '🟢 POTENSI LONG' : '🔴 POTENSI SHORT';
  const zoneDesc = signal.zoneKind === 'round'
    ? 'angka bulat psikologis'
    : `swing, disentuh ${signal.touches}x sebelumnya`;
  // Konteks jarak ke KEDUA arah (permintaan Olan, 15 Agu 2026) -- biar keliatan seberapa
  // "kejepit" harga sekarang, bukan cuma info zona yang trigger sinyal ini doang.
  const upLine = signal.nearestResistance
    ? `📈 Likuiditas ATAS: ${fmtUsd(signal.nearestResistance.price)} (${signal.nearestResistance.distPct.toFixed(2)}% dari sekarang)`
    : '📈 Likuiditas ATAS: -';
  const downLine = signal.nearestSupport
    ? `📉 Likuiditas BAWAH: ${fmtUsd(signal.nearestSupport.price)} (${signal.nearestSupport.distPct.toFixed(2)}% dari sekarang)`
    : '📉 Likuiditas BAWAH: -';
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market
${dirLabel} (zona likuiditas)

Harga sekarang: ${fmtUsd(signal.price)}
Zona likuiditas: ${fmtUsd(signal.zonePrice)} (${zoneDesc})

${upLine}
${downLine}

⚠️ JANGAN LANGSUNG ENTRY. Ini cuma DETEKSI ZONA (struktur harga), bukan data likuidasi asli -- WAJIB dicek dulu sendiri di Coinglass:
🔗 ${COINGLASS_LINK}

📊 Yang dicek: bandingin ketebalan likuidasi LONG vs SHORT di kedua sisi. Pergerakan biasanya "ditarik" ke sisi yang likuidasinya paling TEBAL (magnet buat market maker) -- kalau likuidasi di ATAS lebih tebal dari di BAWAH, itu lebih condong ke arah naik (dan sebaliknya). Baru putuskan arah ${signal.direction === 'long' ? 'LONG' : 'SHORT'} ini beneran cocok sama bacaan itu atau enggak.

🚨 Risiko JAUH lebih tinggi dari Sniper -- leverage super agresif, SL tipis nempel zona. Ini murni info titik yang layak diperhatikan, BUKAN rekomendasi atau ajakan entry. Sepenuhnya keputusan & tanggung jawab sendiri.

💡 JANGAN ALL-IN, modal SUPER KECIL aja. Pakai Kalkulator Exposure buat nentuin sizing sesuai modal sendiri, jangan asal tebak:
🔗 ${KALKULATOR_LINK}

${fmtWita(now)}`;
}

function formatBroken(activeZone, breakPrice, now) {
  const dirLabel = activeZone.direction === 'long' ? 'LONG' : 'SHORT';
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market
⚠️ ZONA ${fmtUsd(activeZone.price)} DITEMBUS

Sinyal potensi ${dirLabel} sebelumnya gak jalan sesuai rencana -- harga nembus zona, bukan mantul (closing sekarang ${fmtUsd(breakPrice)}).

Kalau sempat entry berdasar sinyal itu dan belum keluar, ini pengingat buat dicek ulang.

${fmtWita(now)}`;
}

module.exports = { formatSignal, formatBroken, COINGLASS_LINK };
