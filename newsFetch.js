// Cari berita GRATIS lewat Google News RSS (no API key, no LLM) -- cakupan global + Indonesia + kripto,
// sesuai scope newsUpdate.js. Sentimen ditag pakai keyword matching sederhana (deterministik, "otak sendiri").

// Semua feed pakai locale Indonesia (hl=id&gl=ID&ceid=ID:id) -- Google News otomatis kasih
// hasil dari sumber berbahasa Indonesia buat topik apapun (termasuk bitcoin/global), jadi gak
// perlu translate API/LLM tambahan buat "meng-Indonesiakan" berita.
const FEEDS = [
  { url: 'https://news.google.com/rss/search?q=bitcoin%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Bitcoin' },
  { url: 'https://news.google.com/rss/search?q=ekonomi%20global%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Ekonomi Global' },
  { url: 'https://news.google.com/rss/search?q=ekonomi%20indonesia%20when:1d&hl=id&gl=ID&ceid=ID:id', label: 'Ekonomi Indonesia' },
];

const POSITIVE_KEYWORDS = [
  'naik', 'menguat', 'rally', 'surge', 'gain', 'inflow', 'bullish', 'rebound', 'tumbuh', 'positif',
  'record high', 'all-time high', 'rise', 'jump', 'soar', 'recovery', 'pulih', 'menghijau',
];
const NEGATIVE_KEYWORDS = [
  'turun', 'anjlok', 'crash', 'plunge', 'outflow', 'bearish', 'resesi', 'recession', 'korupsi',
  'perang', 'war', 'sanksi', 'sanction', 'krisis', 'crisis', 'default', 'fall', 'drop', 'slump',
  'selloff', 'melemah', 'merosot', 'PHK', 'layoff',
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

function parseRssItems(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleMatch) continue;
    items.push({
      headline: decodeEntities(stripTags(titleMatch[1])).trim(),
      url: linkMatch ? decodeEntities(stripTags(linkMatch[1])).trim() : '',
      source: sourceMatch ? decodeEntities(stripTags(sourceMatch[1])).trim() : 'Google News',
    });
  }
  return items;
}

function tagSentiment(headline) {
  const lower = headline.toLowerCase();
  const pos = POSITIVE_KEYWORDS.some((k) => lower.includes(k));
  const neg = NEGATIVE_KEYWORDS.some((k) => lower.includes(k));
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
