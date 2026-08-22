// Jalankan 3x sehari (pagi/siang/sore WITA): node newsMonitor.js <pagi|siang|sore>
// Cari berita otomatis (newsFetch.js, RSS Google News gratis) -> format (newsUpdate.js)
// -> arsip WEB + kirim grup WA "BTC Sniper Club" lewat Fonnte.
// MURNI INFORMASI -- gak pernah pengaruhi sinyal/logic tanam-panen manapun.
//
// UPGRADE 22 Agu 2026 (permintaan Olan: "usahakan berita kaela di hari sama unik, kalo tidak
// ada keunikan boleh skip kok, kalo terpaksa sama juga gapapa"): dari 1x/hari jadi 3x/hari
// (pagi/siang/sore), tiap slot dedup TERPISAH (type `news-<slot>`, BUKAN 1 `news` gabungan)
// SUPAYA tiap edisi bisa jalan sendiri-sendiri. Sebelum kirim, dicek dulu: kalau SEMUA headline
// edisi ini udah pernah muncul di edisi-edisi SEBELUMNYA hari yang sama (gak ada yang baru sama
// sekali), edisi ini di-SKIP -- gak maksa kirim ulang isi yang identik cuma buat "penuhin jadwal".
// Kalau paksaan/keadaan bikin tetap ada overlap tinggi tapi ADA >=1 headline baru, tetap kirim
// versi lengkap (bukan cuma yang baru) -- biar pembaca yang baru buka WA hari itu tetap dapat
// gambaran utuh, sesuai instruksi "kalo terpaksa sama juga gapapa".

const { fetchNewsItems } = require('./newsFetch');
const { formatNewsUpdate } = require('./newsUpdate');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily, hasEntryToday, getAll } = require('./archive');
const { localDateKey } = require('./config');

const VALID_SLOTS = ['pagi', 'siang', 'sore'];

// Headline yang UDAH terkirim hari ini lewat slot MANAPUN (news-pagi/news-siang/news-sore) --
// dibaca dari archive.json (isi arsip = pesan sudah-diformat, jadi di-parse balik baris headline-nya
// lewat pola yang sama kayak newsUpdate.js nulisnya: baris "<tag emoji> <headline>").
function headlinesAlreadySentToday(now) {
  const todayKey = localDateKey(now);
  const entries = getAll().filter((e) => e.type && e.type.startsWith('news-') && localDateKey(new Date(e.date)) === todayKey);
  const set = new Set();
  for (const e of entries) {
    for (const line of e.content.split('\n')) {
      const m = line.match(/^(?:🟢|🔴|⚪) (.+)$/);
      if (m) set.add(m[1].trim().toLowerCase());
    }
  }
  return set;
}

async function main() {
  const now = new Date();
  const slot = process.argv[2];

  if (!VALID_SLOTS.includes(slot)) {
    console.error(`ERROR newsMonitor.js: argumen slot wajib salah satu dari ${VALID_SLOTS.join('/')}, dapet: "${slot}"`);
    process.exit(1);
  }

  const type = `news-${slot}`;
  if (hasEntryToday(type, now)) {
    console.log(`[NewsMonitor] ${now.toISOString()} — edisi ${slot} udah kirim hari ini, skip (cegah dobel WA kalau ke-run ulang).`);
    return;
  }

  const items = await fetchNewsItems();

  if (items.length === 0) {
    console.log(`[NewsMonitor] ${now.toISOString()} — gak ada berita ditemukan, skip kirim edisi ${slot}.`);
    return;
  }

  const alreadySent = headlinesAlreadySentToday(now);
  const hasSomethingNew = items.some((item) => !alreadySent.has(item.headline.trim().toLowerCase()));

  if (!hasSomethingNew) {
    console.log(`[NewsMonitor] ${now.toISOString()} — semua headline edisi ${slot} udah pernah dikirim edisi sebelumnya hari ini (gak ada yang unik), skip kirim.`);
    // Tetap dicatat DI ARSIP (bukan WA) biar hasEntryToday nyegah dobel-cek di jam sama kalau workflow ke-retry.
    addOrReplaceDaily(type, `[SKIP -- gak ada berita unik] ${now.toISOString()}`, now);
    return;
  }

  const msg = formatNewsUpdate(now, items, slot);
  console.log(msg);
  addOrReplaceDaily(type, msg, now); // anti-dobel kalau ke-run ulang di jam sama
  await sendWhatsApp(msg);
}

main().catch((e) => {
  console.error('ERROR newsMonitor.js:', e.message);
  process.exit(1);
});
