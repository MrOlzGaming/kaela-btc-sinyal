// rangerRotation.js (3 Okt 2026) -- RANGER ROTASI 8 KOIN (DEMO BingX VST). Olan: "lanjut bangun ranger rotasi 8 koin
// di demo".
//
// Dasar riset (BACKTEST-REGISTRY.md bagian "Ranger 4H MULTI-KOIN" + rangerMultiCoinPortfolio.js): Ranger BTC sering
// NGANGGUR nunggu sinyal. Kalau boleh "pindah" ke koin lain yang lagi ada sinyal -- TETAP 1 posisi pakai modal penuh
// (BUKAN dibagi2) -- hasil 2023-2026 (koin dipilih pakai data <2023): 8 koin 1 posisi $100 -> $377 (CAGR ~42%/thn) vs
// BTC doang $190 (~19%/thn), drawdown tertutup sama ~18%. Bagi modal ke banyak posisi barengan JUSTRU lebih jelek.
//
// Koin (urutan = PRIORITAS kalau 2+ koin sinyal di candle yang sama): BTC, SOL, DOGE, TRX, INJ, ETH, XLM, BNB -- 8 koin
// dengan PF minimum PALING tinggi di DUA era (<2023 & >=2023, semua >= 1,56; rangerMultiCoin.js). FIL (PF <2023
// tertinggi) SENGAJA dibuang -- gagal parah >=2023 (-62%).
//
// Logika = Ranger live PERSIS (rangerAutoTrader.js + rangerBtcDualExec.js):
//   - deteksi di candle 4H closed (data publik Binance spot <COIN>USDT, 1820 candle): detectPatternSignal(PATTERN_PARAMS_4H)
//     + detectFvgSignal(slBuffer 0,5%, tren SMA1200-4H); window bear/bull = siklus halving BTC (isBtcBearWindow) buat
//     SEMUA koin; long cuma di window bull, short cuma di window bear (allowShort cuma pas bear).
//   - sizing hitungExposure(modal = saldo VST x 1/5, SL sinyal, arah) -- short otomatis separuh exposure.
//   - exit polling tiap siklus executor (15 mnt): SL -> tutup; 2R -> tutup 50% & SL ke titik masuk; lewat partial ->
//     trailing SMA60 4H patah ATAU kena breakeven -> tutup; window ganti -> tutup paksa.
//   - Filter DXY Ranger BTC SENGAJA GAK dipakai (config dxyFilter:false) -- backtest yang ngebuktiin rotasi gak pakai DXY.
// Akun: BingX DEMO (BINGX_API_KEY, aset VST) -- akun SAMA dengan Ninja (BTC-USDT). Gak pernah nutup posisi yang bukan
// punya modul ini: kalau di simbol itu udah ada posisi lain (Ninja/manual), koin itu DILEWATI siklus ini.
// Ninja balik-arahnya aman: checkAndClearStrayPosition (ninjaTrader.js) liat order pembuka ber-tag kaela- -> 'unsafe'
// -> Ninja cuma skip, GAK nutup posisi rotasi.
// WA: kebijakan demo (Sniper Club SELALU + Wibowo dapet demo karena gak ada leg real), label "🏹 RANGER ROTASI".

const fs = require('fs');
const path = require('path');
const { sma } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { detectFvgSignal } = require('./fvgDetector');
const { hitung: hitungExposure } = require('./calculator');
const { isBtcBearWindow } = require('./halvingBearWindow');
const { nextSignalId, dayKeyOf } = require('./signalIdGenerator');

const CONFIG_PATH = path.join(__dirname, 'ranger-rotation-config.json');
const JOURNAL_PATH = path.join(__dirname, 'ranger-rotation-journal.json');
const DEFAULT_COINS = ['BTC', 'SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'];
// Diambil LANGSUNG dari Ranger live (bukan salinan) biar gak pernah beda kalau Ranger diubah. main() file itu ter-guard.
const { PATTERN_PARAMS_4H, FVG_TREND_SMA_LEN_4H } = require('./rangerAutoTrader');
const TRAIL_SMA_LEN_4H = 60;
const PARTIAL_RR = 2;
const MODAL_ACTIVE_FRACTION = 1 / 5;
const CANDLES_NEEDED_4H = 1560 + 260;
const SYSTEM = { emoji: '🏹', name: 'RANGER ROTASI' };

function loadConfig() {
  const def = { enabled: false, coins: DEFAULT_COINS, dxyFilter: false };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshJournal() { return { floating: null, lastScanCloseTime: null, closedCount: 0, stats: { wins: 0, losses: 0, totalPnlUsd: 0 }, dailySignalSeq: { dayKey: null, count: 0 }, history: [] }; }
function loadJournal() {
  try { const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')); return { ...freshJournal(), ...j, stats: { ...freshJournal().stats, ...(j.stats || {}) } }; } catch { return freshJournal(); }
}
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

const bingxSymbol = (coin) => `${coin}-USDT`;
const sideOf = (dir) => (dir === 'buy' ? 'LONG' : 'SHORT');

// Sinyal Ranger untuk 1 koin di candle closed terakhir -> {direction, sl, patternType} | null (aturan window SAMA live)
function rangerSignal(candles4h, bearNow) {
  const i = candles4h.length - 1;
  const params = bearNow ? { ...PATTERN_PARAMS_4H, allowShort: true } : PATTERN_PARAMS_4H;
  const cands = [];
  const p = detectPatternSignal(candles4h, i, params); if (p) cands.push(p);
  const f = detectFvgSignal(candles4h, i, { slBufferPct: PATTERN_PARAMS_4H.slBufferPct, trendSmaLen: FVG_TREND_SMA_LEN_4H, allowShort: bearNow }); if (f) cands.push(f);
  return cands.find((s) => (s.direction === 'buy' && !bearNow) || (s.direction === 'sell' && bearNow)) || null;
}

// deps: { cfg, journal, exec, fetchCandles(coin, n), fetchPrice(coin), notify(msg), now(), isBear(date), dxyWeak(), log, fmt:{open,partial,closed,untracked} }
function createRotation(deps) {
  const { cfg, journal: j, exec } = deps;
  const now = deps.now || (() => Date.now());
  const log = deps.log || ((m) => console.log(`[RangerRotasi] ${m}`));
  const coins = cfg.coins || DEFAULT_COINS;
  const signalFn = deps.signalFn || rangerSignal; // bisa disuntik di selftest

  async function roundQty(coin, qty) {
    const info = await exec.getSymbolInfo(bingxSymbol(coin));
    return exec.roundToStepSize(qty, info.stepSize, info.quantityPrecision);
  }

  async function closeQty(f, qty, reason) {
    const r = await exec.emergencyCloseMarket({ symbol: bingxSymbol(f.coin), direction: f.direction, quantity: qty });
    const o = r && r.order ? r.order : r;
    let px = o && Number(o.avgPrice);
    if (!px) px = await deps.fetchPrice(f.coin).catch(() => null);
    return px || null;
  }

  // Jumlah koin MILIK modul ini yang masih kebuka -- JANGAN pernah nutup lebih dari ini (hedge mode BingX bisa
  // ngegabung posisi searah dari modul lain di simbol yang sama, mis. Ninja di BTC-USDT).
  const ownQty = (f, pos) => Math.min(f.remainingQty != null ? f.remainingQty : f.qty, Math.abs(Number(pos.positionAmt)));

  async function finish(f, reason, exitPrice, untracked, closedQty) {
    const remainingQty = closedQty != null ? closedQty : (f.remainingQty != null ? f.remainingQty : f.qty);
    const legPnl = untracked || !exitPrice ? null : (f.direction === 'buy' ? exitPrice - f.entryPrice : f.entryPrice - exitPrice) * remainingQty;
    const total = legPnl === null ? null : (f.realizedPnlUsd || 0) + legPnl;
    if (total !== null) { if (total >= 0) j.stats.wins += 1; else j.stats.losses += 1; j.stats.totalPnlUsd += total; }
    j.closedCount += 1;
    j.history.unshift({ id: f.id, coin: f.coin, direction: f.direction, patternType: f.patternType, entryPrice: f.entryPrice, exitPrice, pnlUsd: total, reason, openedAt: f.openedAt, closedAt: new Date(now()).toISOString() });
    j.history = j.history.slice(0, 100);
    j.floating = null;
    await deps.notify(untracked ? deps.fmt.untracked(f) : deps.fmt.closed(f, exitPrice, total, reason, j.stats));
    log(`TUTUP ${f.coin} ${f.direction} (${reason}) pnl ${total === null ? '?' : total.toFixed(2)}`);
  }

  async function monitor() {
    const f = j.floating;
    if (!f) return;
    const sym = bingxSymbol(f.coin);
    const pos = await exec.getPositionBySide(sym, sideOf(f.direction)).catch(() => undefined);
    if (pos === undefined) { log(`gagal cek posisi ${sym} -- coba siklus depan`); return; }
    if (pos === null || Math.abs(Number(pos.positionAmt)) === 0) { await finish(f, 'OFFLINE_UNTRACKED', null, true); return; }
    const live = await deps.fetchPrice(f.coin).catch(() => null);
    if (!live) { log(`harga ${sym} gagal -- coba siklus depan`); return; }
    const bearNow = deps.isBear(new Date(now()));
    const closeAll = async (reason) => { const q = ownQty(f, pos); const px = await closeQty(f, q, reason); await finish(f, reason, px, false, q); };
    if ((f.direction === 'buy' && bearNow) || (f.direction === 'sell' && !bearNow)) { await closeAll('WINDOW_FLIP'); return; }
    const L = f.direction === 'buy';
    if (!f.partialDone) {
      if (L ? live <= f.sl : live >= f.sl) { await closeAll('SL'); return; }
      if (L ? live >= f.partialTp : live <= f.partialTp) {
        const ownBefore = ownQty(f, pos); // dicatat SEBELUM order tutup (bug ketemu di selftest: dihitung sesudahnya = sisa salah)
        const half = await roundQty(f.coin, ownBefore * 0.5);
        if (half <= 0) { log(`${sym} setengah qty kekecilan buat step -- partial dilewati, tunggu trailing/SL`); f.partialDone = true; f.sl = f.entryPrice; return; }
        const px = await closeQty(f, half, 'PARTIAL');
        const exitPx = px || live;
        f.realizedPnlUsd = (L ? exitPx - f.entryPrice : f.entryPrice - exitPx) * half;
        f.remainingQty = await roundQty(f.coin, ownBefore - half);
        f.partialDone = true; f.sl = f.entryPrice; f.partialAt = new Date(now()).toISOString();
        await deps.notify(deps.fmt.partial(f));
        log(`PARTIAL ${sym} @ ${exitPx} realized ${f.realizedPnlUsd.toFixed(2)}`);
      }
      return;
    }
    if (L ? live <= f.sl : live >= f.sl) { await closeAll('SL_BREAKEVEN'); return; }
    const candles = await deps.fetchCandles(f.coin, TRAIL_SMA_LEN_4H + 5).catch(() => []);
    const trail = sma(candles.map((c) => c.close), TRAIL_SMA_LEN_4H);
    if (trail !== null && (L ? live < trail : live > trail)) await closeAll('TRAIL');
  }

  async function scan() {
    if (j.floating) return;
    const btc = await deps.fetchCandles(coins[0], CANDLES_NEEDED_4H);
    if (!btc.length) { log('candle kosong -- skip'); return; }
    const clock = btc[btc.length - 1].closeTime;
    if (j.lastScanCloseTime !== null && clock <= j.lastScanCloseTime) return; // candle 4H yang sama udah discan
    j.lastScanCloseTime = clock;
    if (now() - clock > 60 * 60e3) { log('candle 4H terakhir udah > 1 jam lalu (cron sempat mati?) -- jangan entry di harga basi'); return; }
    if (cfg.dxyFilter && (await deps.dxyWeak().catch(() => null)) === false) { log('DXY kuat -- skip semua entry siklus ini'); return; }
    const bearNow = deps.isBear(new Date(now()));
    for (const coin of coins) {
      const c = coin === coins[0] ? btc : await deps.fetchCandles(coin, CANDLES_NEEDED_4H).catch(() => []);
      if (c.length < 300) continue;
      const sig = signalFn(c, bearNow, coin);
      if (!sig) continue;
      log(`sinyal ${coin} ${sig.patternType} ${sig.direction}`);
      if (await open(coin, sig)) return; // 1 posisi doang
    }
    log('gak ada sinyal di 8 koin candle ini');
  }

  async function open(coin, sig) {
    const sym = bingxSymbol(coin);
    // Modul lain (Ninja MR BTC-USDT) punya order limit yg NUNGGU fill (belum jadi posisi) -> cek journal-nya juga,
    // biar gak kebuka bareng searah lalu digabung hedge mode.
    if (deps.isCoinBusy && (await deps.isCoinBusy(coin))) { log(`${sym} lagi dipakai modul lain (Ninja) -- lewati`); return false; }
    const any = await exec.getPositionRisk(sym).catch(() => undefined);
    if (any === undefined) { log(`${sym} gagal cek posisi -- lewati koin ini`); return false; }
    if (any && Math.abs(Number(any.positionAmt)) > 0) { log(`${sym} udah ada posisi lain (Ninja/manual) -- lewati, gak numpuk`); return false; }
    const live = await deps.fetchPrice(coin).catch(() => null);
    if (!live) return false;
    const risk = Math.abs(live - sig.sl);
    if (!risk || (sig.direction === 'buy' ? sig.sl >= live : sig.sl <= live)) { log(`${sym} SL udah kelewat harga live -- lewati`); return false; }
    const balance = await exec.getAccountBalance('VST').catch(() => 0);
    const calc = hitungExposure({ modal: balance * MODAL_ACTIVE_FRACTION, entry: live, stopLoss: sig.sl, direction: sig.direction });
    if (!(calc.nilaiPosisi > 0)) { log(`${sym} exposure 0 -- lewati`); return false; }
    await exec.setIsolatedMargin(sym).catch(() => {});
    await exec.setLeverage(sym, calc.leverage, sideOf(sig.direction)).catch(() => {});
    let order;
    try { order = await exec.placeMarketEntry({ symbol: sym, direction: sig.direction, notionalUsd: calc.nilaiPosisi, livePrice: live }); }
    catch (e) { log(`${sym} gagal buka: ${e.message}`); return false; }
    const entryPrice = Number(order.avgPrice) || live, qty = Number(order.executedQty);
    const d = new Date(now());
    if (!j.dailySignalSeq || j.dailySignalSeq.dayKey !== dayKeyOf(d)) j.dailySignalSeq = { dayKey: dayKeyOf(d), count: 0 };
    const signalId = nextSignalId(j.dailySignalSeq.count, d); j.dailySignalSeq.count += 1;
    const rEntry = Math.abs(entryPrice - sig.sl);
    j.floating = {
      id: `ranger-rotasi-${now()}`, signalId, coin, direction: sig.direction, patternType: sig.patternType, entryPrice, qty, remainingQty: qty, sl: sig.sl, originalSl: sig.sl,
      partialTp: sig.direction === 'buy' ? entryPrice + rEntry * PARTIAL_RR : entryPrice - rEntry * PARTIAL_RR,
      leverage: calc.leverage, margin: calc.margin, nilaiPosisi: calc.nilaiPosisi, partialDone: false, realizedPnlUsd: 0, openedAt: d.toISOString(),
    };
    await deps.notify(deps.fmt.open(j.floating));
    log(`BUKA ${sym} ${sig.direction} @ ${entryPrice} qty ${qty} SL ${sig.sl} TP1 ${j.floating.partialTp.toFixed(4)} lev ${calc.leverage}`);
    return true;
  }

  async function runCycle() { await monitor(); if (!j.floating) await scan(); }
  return { runCycle, monitor, scan };
}

// ================= wiring produksi =================
async function fetchCandles4h(coin, count) {
  const { fetchWithRetry } = require('./httpRetry');
  let all = [], endTime = Date.now();
  while (all.length < count) {
    const raw = await (await fetchWithRetry(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=4h&endTime=${endTime}&limit=1000`)).json();
    if (!Array.isArray(raw) || !raw.length) break;
    const parsed = raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] }));
    all = parsed.concat(all); endTime = parsed[0].openTime - 1;
    if (raw.length < 1000) break;
  }
  const t = Date.now();
  return all.filter((c) => c.closeTime <= t).slice(-count);
}
async function fetchBingxDemoPrice(coin) {
  const r = await fetch(`https://open-api-vst.bingx.com/openApi/swap/v2/quote/price?symbol=${bingxSymbol(coin)}`);
  const d = await r.json();
  const p = Number(d && d.data && d.data.price);
  if (!p) throw new Error(`harga ${coin} kosong`);
  return p;
}

function messageFormatters() {
  const { formatAutoOpen, formatAutoPartial, formatAutoClosed, formatWinRateLines, CLOSE_REASON_LABEL, KAELA_ACCESS_URL, EXCHANGE_BADGE } = require('./darkKaelaLog');
  const B = EXCHANGE_BADGE.bingx;
  const label = (f) => `${f.coin}USDT`;
  return {
    open: (f) => formatAutoOpen({ id: f.id, signalId: f.signalId, direction: f.direction, entryPrice: f.entryPrice, sl: f.sl, tp: f.partialTp, marginUsd: f.margin, leverage: f.leverage, nilaiPosisi: f.nilaiPosisi, patternType: f.patternType, mode: f.patternType, assetLabel: label(f) }, new Date(), '', true, null, '', null, B, SYSTEM),
    partial: (f) => formatAutoPartial({ id: f.id, signalId: f.signalId, realizedPnlUsd: f.realizedPnlUsd, entryPrice: f.entryPrice, assetLabel: label(f), patternType: f.patternType, mode: f.patternType }, new Date(), true, null, null, B, SYSTEM),
    closed: (f, exitPrice, total, reason, stats) => {
      const msg = formatAutoClosed({ id: f.id, signalId: f.signalId, direction: f.direction === 'buy' ? 'long' : 'short', mode: f.patternType, entryPrice: f.entryPrice, exitPrice, pnlUsd: total, pnlPct: f.margin && total !== null ? (total / f.margin) * 100 : null, assetLabel: label(f) }, new Date(), true, CLOSE_REASON_LABEL[reason] || reason, null, null, B, SYSTEM);
      return msg.replace(`🔗 ${KAELA_ACCESS_URL}`, formatWinRateLines(stats, 'Ranger Rotasi 8 koin (Demo)', null) + `🔗 ${KAELA_ACCESS_URL}`);
    },
    // Template formatAutoClosedUntracked (darkKaelaLog.js) ngomongin "journal gak pernah nyatet buka" -- GAK cocok di
    // sini (rotasi nyatet bukanya), jadi pesan sendiri: posisi yg DICATAT hilang dari exchange.
    untracked: (f) => [
      `${SYSTEM.emoji} ${SYSTEM.name} · Kaela ${label(f)} (Demo) · ${B} #${f.signalId} — *Posisi Hilang dari Exchange*`,
      `⚠️ ${f.direction === 'buy' ? '🟢 LONG' : '🔴 SHORT'} @ $${f.entryPrice} udah gak ada di BingX -- kemungkinan kena likuidasi di sela pengecekan 15 menit, atau ditutup manual.`,
      'PnL SENGAJA gak dihitung biar gak ngarang angka -- cek riwayat BingX buat angka pastinya.',
      '',
      `🔗 ${KAELA_ACCESS_URL}`,
    ].join('\n'),
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) { console.log('[RangerRotasi] enabled:false -- gak ngapa-ngapain.'); return; }
  const secrets = require('./secrets');
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) { console.log('[RangerRotasi] BINGX_API_KEY kosong -- skip.'); return; }
  const exec = require('./bingxExecutor').createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: true });
  const { sendWhatsAppToSniperClub, } = require('./fonnte');
  const { sendWhatsAppToWibowo } = require('./wibowoNotify');
  const { toSniperClubLink } = require('./darkKaelaLog');
  const journal = loadJournal();
  const rot = createRotation({
    cfg, journal, exec,
    fetchCandles: fetchCandles4h, fetchPrice: fetchBingxDemoPrice,
    notify: async (m) => {
      await sendWhatsAppToSniperClub(toSniperClubLink(m)).catch((e) => console.log('[RangerRotasi] WA Sniper Club gagal:', e.message));
      await sendWhatsAppToWibowo(m).catch((e) => console.log('[RangerRotasi] WA Wibowo gagal:', e.message)); // gak ada leg real -> Wibowo dapet demo (kebijakan)
    },
    isBear: (d) => isBtcBearWindow(d),
    // BTC-USDT dipakai Ninja di akun demo yg SAMA -- jangan masuk kalau Ninja lagi nunggu fill / megang posisi.
    isCoinBusy: async (coin) => {
      if (coin !== 'BTC') return false;
      try { const mr = require('./ninjaMrTrader').loadJournal(); if (mr.pendingEntry || mr.floating) return true; } catch { return true; }
      try { const old = require('./ninjaTrader').loadJournal(); if ((old.trailing || {}).floating) return true; } catch { return true; }
      return false;
    },
    dxyWeak: async () => require('./dxyContext').isDxyWeak(20),
    fmt: messageFormatters(),
  });
  try { await rot.runCycle(); } finally { saveJournal(journal); }
}

if (require.main === module) main().catch((e) => { console.error('[RangerRotasi] ERROR:', e.message); process.exit(1); });

module.exports = { createRotation, rangerSignal, loadConfig, loadJournal, freshJournal, messageFormatters, fetchCandles4h, DEFAULT_COINS, PATTERN_PARAMS_4H };
