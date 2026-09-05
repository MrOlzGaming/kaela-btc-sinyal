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

const LOCK_STALE_MS = 30 * 1000; // proses NORMAL harusnya kelar jauh di bawah ini -- lebih lama = anggap crash
const LOCK_RETRY_MS = 300;
const LOCK_MAX_WAIT_MS = 15 * 1000;

function lockPathFor(journalPath) { return journalPath + '.lock'; }

async function acquireLock(journalPath) {
  const lockPath = lockPathFor(journalPath);
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      fs.closeSync(fd);
      return;
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

function releaseLock(journalPath) {
  try { fs.unlinkSync(lockPathFor(journalPath)); } catch (e) { /* udah ke-unlink duluan (mis. dianggap basi proses lain) -- aman diabaikan */ }
}

// Pembungkus utama -- SEMUA titik keputusan "cek slot floating -> mungkin buka/tutup" yang nyentuh
// journal yang sama WAJIB lewat sini, biar gak ada 2 proses beraksi bersamaan di journal yang sama.
async function withJournalLock(journalPath, fn) {
  await acquireLock(journalPath);
  try {
    return await fn();
  } finally {
    releaseLock(journalPath);
  }
}

module.exports = { withJournalLock };
