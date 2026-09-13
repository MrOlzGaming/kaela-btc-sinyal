// Deteksi pool tambang dari tag ASCII di scriptSig transaksi coinbase (tx pertama tiap blok).
// GRATIS, PASTI (bukan heuristik clustering kayak WalletExplorer/exchangeAddresses.js) -- tag ini
// ditulis LANGSUNG oleh pool bersangkutan di tiap blok yang mereka menangkan (konvensi de-facto
// dipakai explorer besar spt btc.com/blockchain.com sejak lama). Diverifikasi LANGSUNG 13 Sep 2026
// pakai blok live blockchain.info: scriptSig blok terbaru kebaca "...Mined by AntPool901x..." persis.
//
// Kalau tag GAK ketemu -- BUKAN berarti "pool aneh/gak dikenal", banyak pool kecil/solo miner
// emang gak nulis tag standar. Jangan disimpulkan apa-apa dari hasil null selain "gak teridentifikasi".
//
// Data ini numpang GRATIS di blok yang UDAH di-fetch whaleDailyDigest.js (zero API call tambahan).

const KNOWN_POOL_TAGS = [
  ['AntPool', 'AntPool'],
  ['Foundry USA', 'Foundry USA'],
  ['F2Pool', 'F2Pool'],
  ['ViaBTC', 'ViaBTC'],
  ['Binance Pool', 'Binance Pool'],
  ['MARA Pool', 'MARA Pool'],
  ['SpiderPool', 'SpiderPool'],
  ['SBI Crypto', 'SBI Crypto'],
  ['Luxor', 'Luxor'],
  ['SECPOOL', 'SECPOOL'],
  ['poolin', 'Poolin'],
  ['1THash', '1THash'],
  ['Braiins', 'Braiins Pool'],
  ['BTC.com', 'BTC.com'],
  ['OCEAN', 'OCEAN'],
  ['Ultimus', 'Ultimus Pool'],
  ['WhitePool', 'WhitePool'],
  ['EMCDPool', 'EMCDPool'],
];

function hexToPrintableAscii(hex) {
  let str = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    str += (code >= 32 && code <= 126) ? String.fromCharCode(code) : '.';
  }
  return str;
}

// `block` = format blockchain.info rawblock (dipakai bareng whaleFetch.js).
function detectMinerPool(block) {
  const coinbaseTx = block.tx && block.tx[0];
  const scriptHex = coinbaseTx && coinbaseTx.inputs && coinbaseTx.inputs[0] && coinbaseTx.inputs[0].script;
  if (!scriptHex) return null;
  const ascii = hexToPrintableAscii(scriptHex);
  for (const [needle, label] of KNOWN_POOL_TAGS) {
    if (ascii.includes(needle)) return label;
  }
  return null;
}

module.exports = { detectMinerPool, KNOWN_POOL_TAGS };
