// nyopetJournalLock.js -- (5 Sep 2026, permintaan Olan: "bantu atasi sinyal yang numpukin sinyal
// lain") -- KUNCI ANTAR-PROSES buat journal Nyopet. Masalah nyata: nyopetAutoTrader.js (siklus 15
// menit, chart-pattern/FVG/Fed Dovish Grid) DAN econCalendarLiveMonitor.js (siklus 5 menit,
// econ_reaction) BISA SAMA-SAMA nyentuh journal REAL Olan (multi-account-state/<...>-nyopet.json)
// buat event FOMC/NFP yang SAMA -- tanpa kunci, 2 proses `node` terpisah bisa SAMA-SAMA baca "slot
// kosong" sebelum salah satu sempat nulis (race condition beneran, bukan teori).
//
// Lock file SEDERHANA (bukan npm package baru) -- `fs.openSync(path,'wx')` ATOMIK (gagal kalau
// file udah ada), plus deteksi lock BASI (proses pemegang lock crash/mati tanpa sempat lepas --
// kalau dibiarin, journal itu ke-lock SELAMANYA) via umur file lock.
const fs = require('fs');
const crypto = require('crypto');

// 🐛 FIX 19 Sep 2026 -- SEBELUMNYA `LOCK_STALE_MS=30000` + `releaseLock()` unlink TANPA cek
// kepemilikan. Skenario nyata: proses A pegang lock, kerjaannya (fetch candle 4H berpaginasi +
// harga live + waitForFill + kirim WA -- SEMUA di dalam critical section yang sama) kebetulan
// lambat (jaringan flaky, pola sama kayak BUG-KAELATRADE-0005a) tapi BELUM crash, cuma lewat 30
// detik. Proses B nganggep lock basi, HAPUS lock A, bikin lock baru miliknya sendiri. Proses A
// akhirnya kelar, panggil releaseLock() -- ini HAPUS lock milik B (unlink polos gak peduli isi
// file), bukan lock A yang sebenernya udah dicuri. Proses C yang lagi antre bisa ikutan masuk
// SEMENTARA B masih kerja -- 2+ proses nulis journal REAL yang sama bersamaan, race beneran
// kejadian, persis yang komentar lama di atas klaim udah dicegah.
// Fix: (1) NAIKIN ambang basi jadi 90 detik -- lebih toleran ke jaringan lambat, masih JAUH di
// bawah interval cron 15 menit; (2) fencing TOKEN unik per-acquire, `releaseLock` WAJIB cocokin
// token di isi file SEBELUM unlink -- kalau udah beda (berarti lock kita udah dicuri duluan
// karena kelamaan), SKIP unlink, JANGAN ganggu pemegang baru yang sah.
const LOCK_STALE_MS = 90 * 1000; // proses NORMAL harusnya kelar jauh di bawah ini -- lebih lama = anggap crash
const LOCK_RETRY_MS = 300;
const LOCK_MAX_WAIT_MS = 15 * 1000;

function lockPathFor(journalPath) { return journalPath + '.lock'; }

async function acquireLock(journalPath) {
  const lockPath = lockPathFor(journalPath);
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${token} ${new Date().toISOString()}`);
      fs.closeSync(fd);
      return token;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          console.log(`[NyopetJournalLock] Lock "${lockPath}" basi (>${LOCK_STALE_MS}ms) -- proses pemegang kemungkinan crash, lepas paksa.`);
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (e2) { /* lock keburu dilepas proses lain pas dicek -- coba ambil lagi di iterasi berikut */ }
      if (Date.now() > deadline) {
        throw new Error(`Gagal ambil lock "${lockPath}" setelah ${LOCK_MAX_WAIT_MS}ms -- proses lain kemungkinan lagi lama banget/macet.`);
      }
      await new Promise((res) => setTimeout(res, LOCK_RETRY_MS));
    }
  }
}

function releaseLock(journalPath, token) {
  const lockPath = lockPathFor(journalPath);
  try {
    const content = fs.readFileSync(lockPath, 'utf8');
    if (!content.startsWith(token + ' ')) {
      console.log(`[NyopetJournalLock] Lock "${lockPath}" udah bukan token kita (dicuri proses lain krn dianggap basi duluan) -- SKIP unlink, biar gak nge-hapus lock milik proses yang lagi sah kerja.`);
      return;
    }
    fs.unlinkSync(lockPath);
  } catch (e) { /* lock udah gak ada / gak kebaca -- aman diabaikan */ }
}

// Pembungkus utama -- SEMUA titik keputusan "cek slot floating -> mungkin buka/tutup" yang nyentuh
// journal yang sama WAJIB lewat sini, biar gak ada 2 proses beraksi bersamaan di journal yang sama.
async function withJournalLock(journalPath, fn) {
  const token = await acquireLock(journalPath);
  try {
    return await fn();
  } finally {
    releaseLock(journalPath, token);
  }
}

module.exports = { withJournalLock };
