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

// ============ Auto-trader ping-pong (23 Agu 2026) -- BEDA dari formatSignal/formatBroken di atas
// (yang murni ALERT, v1 lama "kaela ga usah open posisi") -- dua fungsi di bawah ini buat era BARU
// Nyopet Binance Demo: Kaela BENERAN buka/tutup posisi sendiri (nyopetAutoTrader.js), pesan ini
// ngasih tau APA YANG BARU DILAKUKAN + KENAPA (bukan cuma info titik kayak dulu). Wajib jelasin
// alasan tiap sinyal (lihat memory feedback-selalu-ada-alasan) + link kalkulator di tiap pesan.
function formatAutoOpen(pos, now) {
  const { formatWinRateLine } = require('./winRate');
  const { formatSignalCore } = require('./signalCore');
  const fs = require('fs');
  const path = require('path');
  const journal = JSON.parse(fs.readFileSync(path.join(__dirname, 'nyopet-journal.json'), 'utf8'));
  const winRateLine = formatWinRateLine(journal.orders || []);
  const modeDesc = pos.mode === 'fade'
    ? `Harga nyentuh zona ${fmtUsd(pos.zonePrice)} (${pos.zoneKind === 'round' ? 'angka bulat psikologis' : pos.zoneTouches ? `swing, disentuh ${pos.zoneTouches}x sebelumnya` : 'swing'}) -- asumsi DEFAULT selalu mantul di sini, jadi counter posisi ngelawan arah gerak barusan.`
    : `Zona ${fmtUsd(pos.zonePrice)} DITEMBUS (gagal nahan, bukan mantul) -- ikutin arah tembusan (momentum), bukan counter lagi.`;
  const coreLines = formatSignalCore({
    direction: pos.direction, entryPrice: pos.entryPrice, tp: pos.tp, sl: pos.sl,
    leverage: pos.leverage, marginUsd: pos.marginUsd, reason: modeDesc,
  });
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market (Binance Demo)
🔵 POSISI DIBUKA

${coreLines.join('\n')}
${winRateLine}

🧪 Ini BINANCE DEMO (duit virtual, riset/latihan) -- bukan uang beneran. Ping-pong otomatis TANPA HENTI antar 2 zona, gak pakai target R:R tetap -- murni ngikutin zona likuiditas.

🧮 Hitung volume/margin sendiri (WAJIB kalau modal beda dari saldo Demo Kaela): ${KALKULATOR_LINK}

${fmtWita(now)}`;
}

function formatAutoClosed(trade, now) {
  const won = trade.pnlUsd >= 0;
  const dirLabel = trade.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
  return `🥷 [Dark] Kaela — 💸 Sinyal Nyopet Market (Binance Demo)
${won ? '✅ KENA TARGET' : '❌ KENA NYAWA'} -- ${dirLabel}

Entry ${fmtUsd(trade.entryPrice)} -> Exit ${fmtUsd(trade.exitPrice)}
PNL: ${trade.pnlUsd >= 0 ? '+' : ''}${fmtUsd(trade.pnlUsd)}

${won ? 'Langsung REVERSE -- posisi baru dibuka arah kebalikan, nembak balik ke zona asal.' : 'Langsung buka posisi baru lagi di zona terdekat -- siklus jalan terus, gak berhenti.'}

${fmtWita(now)}`;
}

module.exports = { formatSignal, formatBroken, formatAutoOpen, formatAutoClosed, COINGLASS_LINK, KALKULATOR_LINK };
