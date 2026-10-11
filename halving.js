// halving.js (11 Okt 2026) -- tanggal HALVING BTC buat semua sistem siklus (inti grid spot, tangga short, DOGE).
// Olan: "jadwalkan auto run saat siap misal pas sekitar 2028". Halving ke-n = blok 210.000 x n. Halving yang udah lewat ditulis
// tetap; halving BERIKUTNYA diperkirakan dari tinggi blok sekarang (rata-rata 10 menit/blok), diperbarui maks 1x/hari, dan begitu
// bloknya udah ketambang tanggal ASLI-nya diambil dari timestamp blok itu -- gak perlu "verifikasi manual" lagi.
// Cache: halving-cache.json (masuk STATE_FILES executor biar gak ilang). Semua fungsi sinkron baca cache; refresh() async (internet).
const fs = require('fs');
const path = require('path');
const CACHE_PATH = path.join(__dirname, 'halving-cache.json');
const KNOWN = { 210000: '2012-11-28', 420000: '2016-07-09', 630000: '2020-05-11', 840000: '2024-04-20' };
const FALLBACK_NEXT = { 1050000: '2028-04-17' }; // perkiraan kasar kalau internet belum pernah kebaca
const EPOCH = 210000;
const APIS = ['https://mempool.space/api', 'https://blockstream.info/api'];

function readCache() { try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; } }

// daftar timestamp halving (ms, urut) = yang udah lewat + perkiraan/asli berikutnya
function halvings(cache = readCache()) {
  const map = { ...KNOWN };
  for (const [b, d] of Object.entries(FALLBACK_NEXT)) if (!map[b]) map[b] = d;
  for (const [b, v] of Object.entries(cache.blocks || {})) map[b] = v.date;
  return Object.keys(map).map(Number).sort((a, b) => a - b).map((b) => Date.parse(map[b]));
}
const daysSinceHalving = (t, hs = halvings()) => { let h = null; for (const x of hs) if (x <= t) h = x; return h == null ? -1 : (t - h) / 864e5; };
const halvingIdx = (t, hs = halvings()) => hs.filter((x) => x <= t).length;
// hari ke-d sejak halving TERAKHIR yang udah lewat -> tanggal (buat pesan "mulai kapan")
const dateOfDay = (d, t = Date.now(), hs = halvings()) => { let h = null; for (const x of hs) if (x <= t) h = x; return h == null ? null : new Date(h + d * 864e5); };

// tanggal mulai jendela [from,to] (hari sejak halving) yang lagi jalan atau BERIKUTNYA (pakai halving perkiraan kalau belum kejadian)
const nextWindowStart = (from, to, t = Date.now(), hs = halvings()) => { for (const x of hs) if (x + to * 864e5 > t) return new Date(x + from * 864e5); return null; };

async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.text(); }
async function fromApis(p) { let err; for (const a of APIS) { try { return await getJson(a + p); } catch (e) { err = e; } } throw err; }

// perbarui perkiraan/asli halving berikutnya. Return { block, date, actual, changedDays }
async function refresh({ force = false, now = Date.now(), fetchText = fromApis } = {}) {
  const cache = readCache();
  if (!force && cache.at && now - cache.at < 20 * 3600e3) return cache.last || null;
  const tip = parseInt(await fetchText('/blocks/tip/height'), 10);
  if (!(tip > 0)) throw new Error('tinggi blok gak kebaca');
  cache.blocks = cache.blocks || {};
  let out = null;
  // halving yang udah ketambang tapi belum punya tanggal asli -> ambil timestamp bloknya
  for (let b = EPOCH; b <= tip; b += EPOCH) {
    if (KNOWN[b] || (cache.blocks[b] && cache.blocks[b].actual)) continue;
    const hash = (await fetchText(`/block-height/${b}`)).trim();
    const blk = JSON.parse(await fetchText(`/block/${hash}`));
    cache.blocks[b] = { date: new Date(blk.timestamp * 1000).toISOString().slice(0, 10), actual: true };
    out = { block: b, ...cache.blocks[b], changedDays: 0 };
  }
  const next = (Math.floor(tip / EPOCH) + 1) * EPOCH;
  const est = new Date(now + (next - tip) * 600e3).toISOString().slice(0, 10);
  const prev = cache.blocks[next] ? Date.parse(cache.blocks[next].date) : Date.parse(FALLBACK_NEXT[next] || est);
  cache.blocks[next] = { date: est, actual: false, tip, at: now };
  if (!out) out = { block: next, date: est, actual: false, changedDays: Math.round((Date.parse(est) - prev) / 864e5) };
  cache.at = now; cache.last = out;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  return out;
}

module.exports = { halvings, daysSinceHalving, halvingIdx, dateOfDay, nextWindowStart, refresh, CACHE_PATH };

if (require.main === module) refresh({ force: true }).then((r) => { console.log(JSON.stringify(r)); console.log(halvings().map((t) => new Date(t).toISOString().slice(0, 10)).join(' | ')); }).catch((e) => { console.error(e.message); process.exitCode = 1; });
