// selfCustodyWallet.js (11 Okt 2026) -- BACA saldo stablecoin (USDT/USDC) di dompet kripto pribadi Olan (Trust Wallet dll),
// murni dari ALAMAT PUBLIK di blockchain. Permintaan Olan: "fitur yang bisa baca dompet kripto, misal trustwallet, jadi kamu
// tau di Farmer bukanya harusnya brapa.. tujuannya keamanan, kita gak tau BingX nanti tiba2 rungkad kayak MtGox/FTX.. mending
// nganggur tapi aman di dompet sendiri".
//
// ⛔ CUMA alamat publik (0x..., T..., dst). Seed phrase / private key GAK PERNAH dibutuhin & GAK BOLEH disimpen di mana pun --
//    modul ini gak bisa kirim/mindahin apa-apa, cuma baca saldo yang emang publik di blockchain.
//
// Dipakai gridTrader.js (Farmer): modal acuan = saldo BingX + saldo stablecoin dompet ini + cadangan bank.
// Config (grid-config.json): "selfCustodyWallets": [{ "chain": "bsc", "address": "0x..." }, { "chain": "tron", "address": "T..." }]
// chain: ethereum | bsc | polygon | arbitrum | base | tron | solana.
// Uji: node selfCustodyWallet.js <chain> <alamat>

const TOKENS = {
  ethereum: { rpc: 'https://ethereum-rpc.publicnode.com', tokens: [['USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6], ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6]] },
  bsc: { rpc: 'https://bsc-rpc.publicnode.com', tokens: [['USDT', '0x55d398326f99059fF775485246999027B3197955', 18], ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18]] },
  polygon: { rpc: 'https://polygon-bor-rpc.publicnode.com', tokens: [['USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6], ['USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6]] },
  arbitrum: { rpc: 'https://arbitrum-one-rpc.publicnode.com', tokens: [['USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6], ['USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6]] },
  base: { rpc: 'https://base-rpc.publicnode.com', tokens: [['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6]] },
};
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SOL_MINTS = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT' };

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function readEvm(chain, address) {
  const c = TOKENS[chain];
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`alamat ${chain} gak valid: ${address}`);
  const out = {};
  for (const [sym, contract, dec] of c.tokens) {
    const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0'); // balanceOf(address)
    const r = await post(c.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data }, 'latest'] });
    if (r.error) throw new Error(`${chain} ${sym}: ${r.error.message}`);
    out[sym] = Number(BigInt(r.result || '0x0')) / 10 ** dec;
  }
  return out;
}

async function readTron(address) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error(`alamat tron gak valid: ${address}`);
  const r = await (await fetch(`https://api.trongrid.io/v1/accounts/${address}`, { signal: AbortSignal.timeout(12000) })).json();
  const acc = r && r.data && r.data[0];
  let usdt = 0;
  for (const t of (acc && acc.trc20) || []) if (t[TRON_USDT] != null) usdt = Number(t[TRON_USDT]) / 1e6;
  return { USDT: usdt };
}

async function readSolana(address) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error(`alamat solana gak valid: ${address}`);
  const out = { USDC: 0, USDT: 0 };
  for (const mint of Object.keys(SOL_MINTS)) {
    const r = await post('https://api.mainnet-beta.solana.com', { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [address, { mint }, { encoding: 'jsonParsed' }] });
    if (r.error) throw new Error(`solana: ${r.error.message}`);
    for (const a of (r.result && r.result.value) || []) out[SOL_MINTS[mint]] += Number(a.account.data.parsed.info.tokenAmount.uiAmount) || 0;
  }
  return out;
}

async function readWallet({ chain, address }) {
  const ch = String(chain || '').toLowerCase();
  if (TOKENS[ch]) return readEvm(ch, address);
  if (ch === 'tron') return readTron(address);
  if (ch === 'solana') return readSolana(address);
  throw new Error(`chain belum didukung: ${chain}`);
}

// Total USD stablecoin semua dompet. Gagal sebagian -> lempar error (caller pakai cache terakhir, jangan nebak 0).
async function readTotalStable(wallets) {
  let total = 0; const detail = [];
  for (const w of wallets || []) {
    const b = await readWallet(w);
    const sum = Object.values(b).reduce((a, x) => a + x, 0);
    total += sum; detail.push({ chain: w.chain, address: `${String(w.address).slice(0, 6)}…${String(w.address).slice(-4)}`, ...b });
  }
  return { total, detail };
}

module.exports = { readWallet, readTotalStable, TOKENS };

if (require.main === module) {
  const [chain, address] = process.argv.slice(2);
  readWallet({ chain, address }).then((b) => console.log(chain, address, b)).catch((e) => { console.log('GAGAL', e.message); process.exitCode = 1; });
}
