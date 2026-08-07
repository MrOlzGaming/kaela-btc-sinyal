// Jalankan tiap hari jam 09:00 WIB: node newsMonitor.js
// Cari berita otomatis (newsFetch.js, RSS Google News gratis) -> format (newsUpdate.js)
// -> arsip WEB + kirim grup WA "BTC Sniper Club" lewat Fonnte.
// MURNI INFORMASI -- gak pernah pengaruhi sinyal/logic tanam-panen manapun.

const { fetchNewsItems } = require('./newsFetch');
const { formatNewsUpdate } = require('./newsUpdate');
const { sendWhatsApp } = require('./fonnte');
const { addOrReplaceDaily } = require('./archive');

async function main() {
  const now = new Date();
  const items = await fetchNewsItems();

  if (items.length === 0) {
    console.log('[NewsMonitor]', now.toISOString(), '— gak ada berita ditemukan hari ini, skip kirim.');
    return;
  }

  const msg = formatNewsUpdate(now, items);
  console.log(msg);
  addOrReplaceDaily('news', msg, now); // anti-dobel kalau ke-run ulang di hari sama
  await sendWhatsApp(msg);
}

main().catch((e) => {
  console.error('ERROR newsMonitor.js:', e.message);
  process.exit(1);
});
