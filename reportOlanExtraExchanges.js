// reportOlanExtraExchanges.js (3 Okt 2026) -- lapor saldo + posisi exchange TAMBAHAN Olan sendiri (Bybit = Ranger Rotasi,
// Bitget = cadangan) ke Kaela Access (kolom ExtraBalances MemberStatus, partial-merge PER exchange di GAS). MURNI BACA.
// Kenapa: Olan nyediain banyak exchange biar tiap sistem punya akun sendiri (gak tumpang tindih) -- tanpa ini saldo Bybit/
// Bitget gak keliatan di dashboard DAN gak ikut NAV pool Wibowo Hedgefund (harga saham salah begitu Bybit real diisi).
// `equity` = saldo + PnL posisi berjalan (dipakai NAV), `balance` = saldo dompet, `positions` = posisi terbuka ternormalisasi.
// Gagal baca 1 exchange -> exchange itu DILEWATI (nilai lama di GAS dipertahanin), exchange lain tetap jalan.

const kaela = require('./kaelaProTraderClient');
const secrets = require('./secrets');

const MASTER_NOMOR = '6281299303888';

function normBybit(p) {
  return { symbol: p.symbol, direction: p.side === 'Sell' ? 'sell' : 'buy', entryPrice: Number(p.avgPrice) || 0, markPrice: Number(p.markPrice) || 0, leverage: Number(p.leverage) || 0, marginUsd: Number(p.positionIM) || 0, notionalUsd: Math.abs(Number(p.positionValue) || 0), unrealizedPnlUsd: Number(p.unrealisedPnl) || 0 };
}
function normBitget(p) {
  return { symbol: p.symbol, direction: p.holdSide === 'short' ? 'sell' : 'buy', entryPrice: Number(p.openPriceAvg) || 0, markPrice: Number(p.markPrice) || 0, leverage: Number(p.leverage) || 0, marginUsd: Number(p.marginSize) || 0, notionalUsd: Math.abs(Number(p.total) * Number(p.markPrice) || 0), unrealizedPnlUsd: Number(p.unrealizedPL) || 0 };
}

function normBingxStd(p) {
  return { symbol: p.symbol, direction: String(p.positionSide).toUpperCase() === 'SHORT' ? 'sell' : 'buy', entryPrice: Number(p.avgPrice || p.entryPrice) || 0, markPrice: Number(p.markPrice) || 0, leverage: Number(p.leverage) || 0, marginUsd: Number(p.initialMargin || p.margin) || 0, notionalUsd: Math.abs(Number(p.positionValue) || 0), unrealizedPnlUsd: Number(p.unrealizedProfit) || 0 };
}
// BingX Standard Futures -- MURNI GET (pola sama stdFuturesLadderMonitor.js)
function bingxStdReader(key, secret) {
  const crypto = require('crypto');
  return async function get(p, params = {}) {
    const q = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    const ps = (q ? q + '&' : '') + `timestamp=${Date.now()}`;
    const sig = crypto.createHmac('sha256', secret).update(ps).digest('hex');
    const j = await (await fetch(`https://open-api.bingx.com${p}?${ps}&signature=${sig}`, { headers: { 'X-BX-APIKEY': key }, signal: AbortSignal.timeout(20000) })).json();
    if (j.code !== 0) throw new Error(`BingX std (code ${j.code}): ${j.msg}`);
    return j.data;
  };
}

async function report(label, mode, exchange, readFn) {
  try {
    const info = await readFn();
    await kaela.recordExtraBalance(MASTER_NOMOR, mode, exchange, info);
    console.log(`[ReportExtraExchanges] OK ${label} -- equity $${info.equity.toFixed(2)}, ${info.positions.length} posisi.`);
  } catch (e) {
    console.log(`[ReportExtraExchanges] ${label} gagal (dilewati, nilai lama dipertahanin): ${e.message}`);
  }
}

async function main() {
  if (secrets.BYBIT_API_KEY_DEMO && secrets.BYBIT_API_SECRET_DEMO) {
    const c = require('./bybitExecutor').createBybitClient({ apiKey: secrets.BYBIT_API_KEY_DEMO, apiSecret: secrets.BYBIT_API_SECRET_DEMO, testnet: true });
    await report('Bybit demo', 'demo', 'bybit', async () => ({ balance: await c.getWalletBalance(), equity: await c.getEquity(), positions: (await c.getAllPositions()).map(normBybit) }));
  }
  if (secrets.BYBIT_API_KEY && secrets.BYBIT_API_SECRET) {
    const c = require('./bybitExecutor').createBybitClient({ apiKey: secrets.BYBIT_API_KEY, apiSecret: secrets.BYBIT_API_SECRET, testnet: false });
    await report('Bybit real', 'real', 'bybit', async () => ({ balance: await c.getWalletBalance(), equity: await c.getEquity(), positions: (await c.getAllPositions()).map(normBybit) }));
  }
  // (5 Okt 2026, Olan: "7 exchange, semua sistem harus sesuai") -- Bitget DEMO (key demo baru disinkron laptop<->VPS) + BingX
  // STANDARD FUTURES (DCA Tangga, akun terpisah dari Perpetual Ninja -- key SAMA). Real Std Futures ikut NAV pool (kayak Spot/Earn).
  if (secrets.BITGET_DEMO_API_KEY && secrets.BITGET_DEMO_API_SECRET && secrets.BITGET_DEMO_API_PASSPHRASE) {
    const c = require('./bitgetExecutor').createBitgetClient({ apiKey: secrets.BITGET_DEMO_API_KEY, apiSecret: secrets.BITGET_DEMO_API_SECRET, passphrase: secrets.BITGET_DEMO_API_PASSPHRASE, testnet: true });
    await report('Bitget demo', 'demo', 'bitget', async () => {
      const eq = await c.getWalletBalance('USDT');
      const pos = ((await c.getAllPositions()) || []).filter((p) => Math.abs(Number(p.total)) > 0).map(normBitget);
      return { balance: eq, equity: eq, positions: pos };
    });
  }
  if (secrets.BINGX_API_KEY && secrets.BINGX_API_SECRET) {
    const std = bingxStdReader(secrets.BINGX_API_KEY, secrets.BINGX_API_SECRET);
    for (const [mode, asset] of [['demo', 'VST'], ['real', 'USDT']]) {
      await report(`BingX Std Futures ${mode}`, mode, 'bingx_std', async () => {
        const bal = ((await std('/openApi/contract/v1/balance')) || []).find((b) => b.asset === asset) || {};
        const balance = Number(bal.balance) || 0;
        const all = (await std('/openApi/contract/v1/allPosition')) || [];
        // allPosition gak misahin VST/USDT -- posisi cuma ditempel ke akun real (DCA Tangga Olan = real)
        const positions = mode === 'real' ? all.map(normBingxStd) : [];
        return { balance, equity: balance + (Number(bal.crossUnPnl) || 0), positions };
      });
    }
  }
  if (secrets.BITGET_API_KEY && secrets.BITGET_API_SECRET && secrets.BITGET_API_PASSPHRASE) {
    const c = require('./bitgetExecutor').createBitgetClient({ apiKey: secrets.BITGET_API_KEY, apiSecret: secrets.BITGET_API_SECRET, passphrase: secrets.BITGET_API_PASSPHRASE, testnet: false });
    await report('Bitget real', 'real', 'bitget', async () => {
      const eq = await c.getWalletBalance('USDT');
      const pos = ((await c.getAllPositions()) || []).filter((p) => Math.abs(Number(p.total)) > 0).map(normBitget);
      return { balance: eq, equity: eq, positions: pos };
    });
  }
}

main().catch((e) => { console.error('[ReportExtraExchanges] ERROR:', e.message); process.exit(1); });
