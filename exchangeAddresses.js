// Daftar alamat cold wallet exchange yang DIKETAHUI PUBLIK -- dikurasi manual dari bitinfocharts.com
// (top-100-richest-bitcoin-addresses.html, diverifikasi live 2026-08-07, bukan dari ingatan/tebakan).
//
// ⚠️ JUJUR PERLU DIKETAHUI:
// - Ini CUMA cold wallet besar yang labelnya udah dikonfirmasi publik -- BUKAN daftar lengkap.
//   Exchange punya banyak hot wallet/deposit address lain yang gak ada di sini.
// - Gak ada cara gratis buat dapetin daftar lengkap & real-time (itu yang dijual mahal sama
//   Arkham/Nansen/Whale Alert). Ini best-effort, bukan jaminan akurat 100%.
// - Kalau alamat GAK ketemu di daftar ini, itu BUKAN berarti pasti wallet pribadi biasa --
//   bisa aja exchange yang gak ke-cover, cuma "gak teridentifikasi" (makanya default netral).
// - Perlu di-refresh manual dari waktu ke waktu -- exchange bisa pindah wallet.

const EXCHANGE_ADDRESSES = {
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': 'Binance',
  '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6': 'Binance',
  '3LYJfcfHPXYJreMsASk2jkn69LWEYKzexb': 'Binance',
  'bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2': 'Robinhood',
  'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97': 'Bitfinex',
  '3MgEAFWu1HKSnZ5ZsC8qf61ZW18xrP5pgd': 'OKEx',
};

// direction: 'TO_EXCHANGE' (deposit, ada di output) | 'FROM_EXCHANGE' (withdrawal, ada di input) | null
function detectExchangeDirection(tx) {
  for (const input of tx.inputs || []) {
    const addr = input.prev_out && input.prev_out.addr;
    if (addr && EXCHANGE_ADDRESSES[addr]) {
      return { direction: 'FROM_EXCHANGE', exchange: EXCHANGE_ADDRESSES[addr] };
    }
  }
  for (const out of tx.out || []) {
    if (out.addr && EXCHANGE_ADDRESSES[out.addr]) {
      return { direction: 'TO_EXCHANGE', exchange: EXCHANGE_ADDRESSES[out.addr] };
    }
  }
  return null;
}

module.exports = { EXCHANGE_ADDRESSES, detectExchangeDirection };
