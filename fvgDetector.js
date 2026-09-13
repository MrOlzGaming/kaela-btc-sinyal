// Deteksi Fair Value Gap (FVG) buat LIVE (22 Agu 2026) -- satu sumber kebenaran dipakai backtest
// (backtestFVG.js) MAUPUN live (sniperAutoAnalysis.js), sama pola kayak chartPatterns.js.
// Riset lengkap+hasil validasi ada di backtestFVG.js -- file ini murni fungsi deteksi.
//
// FVG = pola 3 candle: candle1.high < candle3.low (gap NAIK, dianggap "support" -- zona yang
// belum sempat ditransaksikan krn harga gerak kelewat cepat/displacement). Sinyal: harga koreksi
// balik masuk zona (masih AKTIF/belum "keisi" penuh) + konfirmasi pantul (tutup balik di atas
// batas atas gap). SL di bawah batas bawah gap (invalidasi -- gap keisi penuh = thesis gugur).

function detectBullishFVG(daily, i) {
  if (i < 2) return null;
  const c1 = daily[i - 2], c3 = daily[i];
  if (c1.high < c3.low) return { gapTop: c3.low, gapBottom: c1.high, createdIdx: i };
  return null;
}

// Mirror dari detectBullishFVG (13 Sep 2026, permintaan Olan: "sinyal short-nya begitu ketemu
// FVG, sebut price area yang ditunggu") -- gap TURUN (candle1.low > candle3.high), dianggap
// "resistance" (zona yang belum sempat ditransaksikan pas harga jatuh cepat/displacement).
// Sinyal short: harga koreksi NAIK balik masuk zona (masih AKTIF/belum "keisi" penuh) +
// konfirmasi DITOLAK (tutup balik di bawah batas bawah gap). SL di atas batas atas gap.
function detectBearishFVG(daily, i) {
  if (i < 2) return null;
  const c1 = daily[i - 2], c3 = daily[i];
  if (c1.low > c3.high) return { gapTop: c1.low, gapBottom: c3.high, createdIdx: i };
  return null;
}

// Deteksi TERPADU buat live -- rescan dari histori penuh tiap dipanggil (stateless, sama gaya
// detectPatternSignal di chartPatterns.js), gak nyimpen state antar-run. `trendSmaLen` = filter
// tren besar (SMA200 default, ketemu perlu dari riset -- tanpa ini banyak sinyal palsu di tengah
// downtrend besar, lihat backtestFVG.js).
// `usedGapTimes` (Set of closeTime, opsional) -- daftar candle closeTime yang MEMBENTUK gap yang
// UDAH PERNAH dipakai buat order (menang lewat trail ATAU rugi lewat SL, dua-duanya) -- WAJIB
// dikecualikan biar zona yang sama gak nembak order KEDUA begitu order pertamanya ditutup (beda
// dari backtest yang otomatis nyingkirin zona abis dipakai -- ketemu pas verifikasi, live tanpa
// ini bisa re-fire zona yang barusan MENANG). Pakai closeTime (bukan index array) biar tetap
// valid lintas-run walau jumlah candle histori yang di-fetch beda tiap kali.
function detectFvgSignal(daily, i, opts = {}) {
  const { slBufferPct = 0, trendSmaLen = 200, usedGapTimes = new Set(), maxDistanceFromGapPct = 3, allowShort = false } = opts;
  const lastPrice = daily[i].close;

  let trendSma = null;
  if (trendSmaLen !== null && i >= trendSmaLen) {
    const closes = daily.slice(Math.max(0, i - trendSmaLen + 1), i + 1).map((c) => c.close);
    trendSma = closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  // Scan semua FVG BULLISH yang kebentuk sebelum hari ini, cari yang MASIH AKTIF (belum keisi
  // penuh) dan udah PERNAH disentuh (low <= gapTop) sebelum hari ini, lalu HARI INI baru tutup
  // balik di atas gapTop (konfirmasi pantul). CUMA dicari kalau harga di ATAS tren besar (jangan
  // cari FVG bounce di tengah downtrend).
  if (trendSma === null || lastPrice >= trendSma) {
    for (let k = i - 1; k >= 2; k--) {
      if (usedGapTimes.has(daily[k].closeTime)) continue;
      const fvg = detectBullishFVG(daily, k);
      if (!fvg) continue;
      // Cek apakah gap ini udah keisi PENUH (low tembus gapBottom) di HARI MANAPUN antara
      // pembentukannya dan KEMARIN (belum termasuk hari ini).
      let filled = false, touchedBefore = false;
      for (let j = k + 1; j < i; j++) {
        if (daily[j].low <= fvg.gapBottom) { filled = true; break; }
        if (daily[j].low <= fvg.gapTop) touchedBefore = true;
      }
      if (filled) continue;
      if (daily[i].low <= fvg.gapBottom) continue; // hari ini sendiri malah keisi penuh -- invalid
      if (!touchedBefore && daily[i].low > fvg.gapTop) continue; // belum pernah disentuh & hari ini juga gak nyentuh
      // Konfirmasi: hari ini tutup di atas gapTop (baik nyentuh hari ini atau nyentuh sebelumnya)
      if (lastPrice > fvg.gapTop) {
        // ⚠️ BUG KETEMU+FIX 3 Sep 2026 (Olan: "bukannya tunggu dulu kena area gap yang kosong itu
        // baru buka posisi.. sedang fvg sekarang asal buka posisi walau di pucuk") -- SEBELUM ini,
        // syarat "lastPrice > gapTop" doang TANPA batas jarak -- begitu gap PERNAH kesentuh+konfirmasi
        // SEKALI, dia dianggap valid SELAMANYA sampai gap-nya keisi penuh, gak peduli udah berapa
        // lama/berapa jauh harga lari abis itu. Fix: WAJIB harga sekarang MASIH DEKET gapTop
        // (default maks 3% di atasnya) -- konsep FVG yang bener itu "entry abis/pas kena area
        // gap", bukan "entry di harga berapa aja asal pernah kesentuh".
        const distanceFromGapPct = (lastPrice - fvg.gapTop) / fvg.gapTop * 100;
        if (distanceFromGapPct > maxDistanceFromGapPct) continue;
        return { direction: 'buy', sl: fvg.gapBottom * (1 - slBufferPct / 100), patternType: 'fvg_bounce', gapTop: fvg.gapTop, gapBottom: fvg.gapBottom, gapCreatedTime: daily[k].closeTime };
      }
    }
  }

  // FVG BEARISH (13 Sep 2026, mirror dari bullish -- permintaan Olan: "sinyal shortnya begitu
  // ketemu FVG, sebut price area yang ditunggu buat lakukan short"). SAMA PERSIS logikanya, semua
  // perbandingan dibalik (high<->low, atas<->bawah). CUMA dicari kalau allowShort DAN harga di
  // BAWAH tren besar (kebalikan filter bull -- jangan cari short FVG di tengah uptrend besar).
  if (allowShort && (trendSma === null || lastPrice <= trendSma)) {
    for (let k = i - 1; k >= 2; k--) {
      if (usedGapTimes.has(daily[k].closeTime)) continue;
      const fvg = detectBearishFVG(daily, k);
      if (!fvg) continue;
      let filled = false, touchedBefore = false;
      for (let j = k + 1; j < i; j++) {
        if (daily[j].high >= fvg.gapTop) { filled = true; break; }
        if (daily[j].high >= fvg.gapBottom) touchedBefore = true;
      }
      if (filled) continue;
      if (daily[i].high >= fvg.gapTop) continue; // hari ini sendiri malah keisi penuh -- invalid
      if (!touchedBefore && daily[i].high < fvg.gapBottom) continue; // belum pernah disentuh & hari ini juga gak nyentuh
      // Konfirmasi: hari ini tutup di bawah gapBottom (ditolak turun dari zona resistance)
      if (lastPrice < fvg.gapBottom) {
        const distanceFromGapPct = (fvg.gapBottom - lastPrice) / fvg.gapBottom * 100;
        if (distanceFromGapPct > maxDistanceFromGapPct) continue; // sama guard "jangan nyamber gap lama yang udah jauh"
        return { direction: 'sell', sl: fvg.gapTop * (1 + slBufferPct / 100), patternType: 'fvg_bounce_bear', gapTop: fvg.gapTop, gapBottom: fvg.gapBottom, gapCreatedTime: daily[k].closeTime };
      }
    }
  }
  return null;
}

module.exports = { detectBullishFVG, detectBearishFVG, detectFvgSignal };
