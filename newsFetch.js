// Cari berita GRATIS lewat Google News RSS (no API key, no LLM) -- cakupan global + Indonesia + kripto,
// sesuai scope newsUpdate.js. Sentimen ditag pakai keyword matching sederhana (deterministik, "otak sendiri").

// Semua feed pakai locale Indonesia (hl=id&gl=ID&ceid=ID:id) -- Google News otomatis kasih
// hasil dari sumber berbahasa Indonesia buat topik apapun (termasuk bitcoin/global), jadi gak
// perlu translate API/LLM tambahan buat "meng-Indonesiakan" berita.
const FEEDS = [
  { url: 'https://news.google.com/rss/search?q=bitcoin%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Bitcoin' },
  { url: 'https://news.google.com/rss/search?q=ekonomi%20global%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Ekonomi Global' },
  { url: 'https://news.google.com/rss/search?q=ekonomi%20indonesia%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Ekonomi Indonesia' },
  // Force majeure (22 Agu 2026, permintaan Olan: "bencana alam dan perang itu sesuatu force
  // majure boleh dimasukkan, karena bakal mengait ke ekonomi juga baik low atau signifikan") --
  // gempa/bencana + perang/konflik geopolitik, dua-duanya bisa gerakin pasar (rantai pasok,
  // harga komoditas/energi, selera risiko) walau gak selalu keliatan langsung di berita "ekonomi".
  { url: 'https://news.google.com/rss/search?q=(bencana%20alam%20OR%20gempa%20OR%20banjir)%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Bencana Alam' },
  { url: 'https://news.google.com/rss/search?q=(perang%20OR%20konflik%20geopolitik)%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Perang & Konflik' },
];

// 🟢 kata yang jelas nada POSITIF (hati-hati kata ambigu kayak "melonjak"/"naik tajam" SENGAJA
// gak dimasukkan -- itu bisa positif buat harga kripto tapi negatif buat inflasi/harga minyak,
// keyword matching gak bisa bedain konteks itu, mending netral daripada salah tag).
const POSITIVE_KEYWORDS = [
  'naik', 'menguat', 'rally', 'surge', 'gain', 'inflow', 'bullish', 'rebound', 'tumbuh', 'positif',
  'record high', 'all-time high', 'rise', 'jump', 'soar', 'recovery', 'pulih', 'menghijau',
  'membaik', 'surplus', 'untung', 'laba', 'optimis', 'melesat', 'cuan', 'terkerek', 'terdongkrak',
  'membukukan untung', 'moncer',
];
// 🔴 kata yang jelas nada NEGATIF
const NEGATIVE_KEYWORDS = [
  'turun', 'anjlok', 'crash', 'plunge', 'outflow', 'bearish', 'resesi', 'recession', 'korupsi',
  'perang', 'war', 'sanksi', 'sanction', 'krisis', 'crisis', 'default', 'fall', 'drop', 'slump',
  'selloff', 'sell-off', 'melemah', 'merosot', 'phk', 'layoff', 'rugi', 'kerugian', 'defisit',
  'gagal bayar', 'bangkrut', 'pailit', 'tersendat', 'melambat', 'melesu', 'lesu', 'tertekan',
  'ambruk', 'jatuh', 'skandal', 'penipuan', 'hack', 'diretas', 'dicuri', 'curi', 'darurat',
  'terancam', 'ancaman', 'ketegangan', 'memanas', 'konflik', 'rentan', 'rapuh',
];

const { fetchWithRetry } = require('./httpRetry');

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

// Google News RSS nulis <title> format "Headline - Nama Sumber" (redundan -- sumbernya UDAH
// kita tampilin sendiri di baris terpisah). Fix 22 Agu 2026 (lapor Olan: "link link nge bug" --
// investigasi: link REDIRECT-nya sendiri sah/jalan normal, yang KELIHATAN buggy itu suffix
// " - Sumber" nempel di headline yang KADANG kepotong Google sendiri di tengah kata pas
// headline aslinya panjang, jadi kesannya "Judul kepotong aneh - Sumber" dobel sama baris
// sumber di bawahnya). Buang suffix " - <persis nama sumber>" kalau cocok PERSIS -- jangan
// buang tanda "-" biasa yang emang bagian asli headline (banyak judul berita pakai " - " buat
// klausa, jangan disangka semua itu suffix sumber).
function stripSourceSuffix(title, source) {
  if (!source) return title;
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleMatch) continue;
    const source = sourceMatch ? decodeEntities(stripTags(sourceMatch[1])).trim() : 'Google News';
    const rawHeadline = decodeEntities(stripTags(titleMatch[1])).trim();
    items.push({
      headline: stripSourceSuffix(rawHeadline, source),
      url: linkMatch ? decodeEntities(stripTags(linkMatch[1])).trim() : '',
      source,
    });
  }
  return items;
}

// Word-boundary match, BUKAN substring .includes() -- .includes('war') dulu ke-trigger sama
// "warga"/"wartawan"/"warta"/"warna" (kata Indonesia biasa banget) jadi salah tag negatif tiap
// ada berita nyebut "warga" doang. \b aman juga buat frasa berspasi/berstrip ("record high",
// "sell-off") karena spasi & strip itu sendiri udah non-word-char.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function hasWord(text, keyword) {
  return new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i').test(text);
}
function tagSentiment(headline) {
  const pos = POSITIVE_KEYWORDS.some((k) => hasWord(headline, k));
  const neg = NEGATIVE_KEYWORDS.some((k) => hasWord(headline, k));
  if (pos && !neg) return 'positif';
  if (neg && !pos) return 'negatif';
  return 'netral';
}

async function fetchNewsItems(maxPerFeed = 3) {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetchWithRetry(feed.url);
      const xml = await res.text();
      const items = parseRssItems(xml).slice(0, maxPerFeed);
      for (const item of items) all.push({ ...item, sentiment: tagSentiment(item.headline) });
    } catch (e) {
      // 1 feed gagal (setelah retry) gak boleh gugurin feed lain -- lanjut aja
      console.error(`[News] Gagal fetch ${feed.label} setelah retry:`, e.message);
    }
  }

  const seen = new Set();
  return all.filter((item) => {
    const key = item.headline.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { fetchNewsItems };

if (require.main === module) {
  fetchNewsItems().then((items) => {
    console.log(`Ditemukan ${items.length} berita:\n`);
    for (const item of items) {
      console.log(`[${item.sentiment}] ${item.headline}`);
      console.log(`  ${item.source} — ${item.url}\n`);
    }
  });
}
