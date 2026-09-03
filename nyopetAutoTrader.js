// Nyopet Auto-Trader -- era Binance Demo (23 Agu 2026, desain Olan). LOCAL ONLY (numpang jalan
// bareng localLiveExecutor.js di run-local-executor.ps1) -- Binance Demo diblokir dari GitHub
// Actions, dan sistem ini butuh cek SETIAP SIKLUS (bukan cuma pas ada sinyal baru) buat mantau
// posisi floating, jadi gak worth dipisah cloud-detect/local-execute kayak Sniper.
//
// MULTI-ASET -- loop tiap aset di NYOPET_ASSETS, TIAP ASET dapet slot 1 posisi SENDIRI-SENDIRI.
// MULTI-AKUN -- factory `createNyopetTrader({...})`, kredensial/journal-path/pengirim-WA di-CLOSURE
// per instance. Wrapper module-level (main di bawah) = instance DEFAULT (akun Olan sendiri).
//
// ============ "NYOPET V2" (30 Agu 2026, riset backtest -- lihat memori project-dark-kaela) ============
// GANTI TOTAL mesin zona-likuiditas-ping-pong (PF~0,96, marginal/negatif di backtest yang bener)
// ke mesin Sniper yang UDAH TERBUKTI edge: chart pattern (flag/wedge, `chartPatterns.js`) + FVG
// (`fvgDetector.js`) -- SATU sumber kebenaran SAMA yang dipakai Sniper live, gak ada logic
// dobel/reimplementasi. Bedanya dari Sniper:
//   - Timeframe 4H (bukan harian) -- window lookback pola di-RESCALE x6 (6 candle 4H = 1 hari)
//     biar signifikansi strukturalnya SETARA sama yang tervalidasi di Sniper harian -- WAJIB,
//     backtest awal (window candle-count APA ADANYA) hasilnya wipeout total, ternyata cuma
//     artefak window kependekan, BUKAN kesimpulan asli. JANGAN PERNAH balik ke window default
//     Sniper (candle-count harian) buat data 4H.
//   - LONG-ONLY (bukan long+short) -- short kebukti ngerusak signifikan di backtest 4H, DUA-DUANYA
//     aset (BTC & Emas terutama, win rate short cuma 14,3% + 0% di 2020-2021).
//   - Modal yang dimasukin exposure calculator = saldo/5 ("cheat", nurunin drawdown SIGNIFIKAN
//     di backtest -- BUKAN cuma "lebih agresif" kayak dulu dikira, size lebih kecil per-trade
//     bikin kurva modal lebih halus, PF malah sedikit lebih baik).
//   - Exit 2-TAHAP (partial 2R + trail SMA breakeven, SAMA validasi kayak Sniper) TAPI via
//     POLLING+MARKET ORDER (`emergencyCloseMarket` quantity sebagian), BUKAN placed conditional
//     order (`placeStopLoss`/`placeTakeProfit`) -- endpoint conditional order MEXC (`planorder/
//     place`) masih UNVERIFIED live (lihat memori project-kaela-multi-exchange), polling+market
//     order cuma pakai primitive yang UDAH TERBUKTI jalan (placeMarketEntry/emergencyCloseMarket/
//     getPositionRisk, SAMA yang dipakai sistem lama). Ini simplifikasi SADAR dari backtest
//     (yang modelnya placed-order-agnostic, R-multiple murni) -- TIDAK mengubah profil R yang
//     divalidasi, cuma cara EKSEKUSI-nya (cek tiap siklus ~15 menit, bukan nunggu exchange
//     otomatis eksekusi order kondisional).
//
// SKEMA JURNAL 100% sama sniper-orders.json ({balance, orders[]} + status
// floating/closed_tp/closed_sl, tiap order punya field `asset`) -- gak ada batas 100 trade lagi.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sma } = require('./technicalAnalysis');
const { detectPatternSignal } = require('./chartPatterns');
const { detectFvgSignal } = require('./fvgDetector');
const { hitung: hitungExposure } = require('./calculator');
const binanceExecutorDefault = require('./binanceExecutor');
const mexcExecutorDefault = require('./mexcExecutor');
const { formatAutoOpen, formatAutoClosed, formatAutoPartial, CLOSE_REASON_LABEL } = require('./darkKaelaLog');
const { sendWhatsApp } = require('./fonnte');
const { isLiveTradingEnabled } = require('./killSwitch');
const { NYOPET_ASSETS } = require('./nyopetAssetConfig');
const { isInsufficientBalanceError, formatInsufficientBalanceAlert, shouldAlertInsufficientBalance } = require('./balanceAlert');
const { formatDxyLine, isDxyWeak } = require('./dxyContext');

const DEFAULT_JOURNAL_PATH = path.join(__dirname, 'nyopet-journal.json');
// "Modal aktif" = 1/5 saldo -- konvensi LAMA dipertahanin (bukan hal baru dari riset v2, cuma
// sekarang eksplisit dipanggil "cheat exposure" -- lihat memori project-dark-kaela). Kalkulator
// exposure TETAP dipakai persis sama, cuma `modal` yang diinput ke situ udah dikecilin duluan.
const MODAL_ACTIVE_FRACTION = 1 / 5;
// Window RESCALED x6 buat 4H (6 candle 4H = 1 hari) -- lihat catatan panjang di atas, JANGAN
// diubah balik ke default candle-count Sniper harian.
const PATTERN_PARAMS_4H = {
  poleLookbackRange: [30, 120], flagLookbackRange: [18, 90], poleMinMovePct: 15, flagMaxRangePct: 8,
  wedgeLookbackRange: [90, 240], wedgeMinTouches: 2, wedgeConvergenceRatio: 0.65,
  allowShort: false, slBufferPct: 0.5,
};
const FVG_TREND_SMA_LEN_4H = 1200;
const TRAIL_SMA_LEN_4H = 60;
const PARTIAL_RR = 2; // target tahap 1 = 2x risiko, sama kayak Sniper
const CANDLES_NEEDED_4H = 1560 + 260; // warmup + buffer buat window terlebar (wedge 240)

// Binance klines API CAP di 1000 candle per request (dicek langsung 30 Agu 2026 -- limit=1820
// tetap balikin 1000 doang, BUKAN nolak/error, jadi diem-diem kepotong kalau gak di-paginate).
// FVG_TREND_SMA_LEN_4H=1200 BUTUH lebih dari sekali fetch. Paginate MUNDUR dari sekarang pakai
// `endTime`, gabung urut kronologis -- beda dari fetchCandles() biasa (technicalAnalysis.js) yang
// 1x request doang, cukup buat kebutuhan lain tapi TIDAK cukup di sini.
async function fetchCandles4hPaginated(symbol, count) {
  const { fetchWithRetry } = require('./httpRetry');
  const BASE = 'https://data-api.binance.vision/api/v3/klines';
  let all = [];
  let endTime = Date.now();
  while (all.length < count) {
    const res = await fetchWithRetry(`${BASE}?symbol=${symbol}&interval=4h&endTime=${endTime}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    const parsed = raw.map((c) => ({ openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], closeTime: c[6] }));
    all = parsed.concat(all);
    endTime = parsed[0].openTime - 1;
    if (raw.length < 1000) break; // udah nyampe histori paling awal
  }
  const nowMs = Date.now();
  return all.filter((c) => c.closeTime <= nowMs).slice(-count);
}

function sign(q, s) { return crypto.createHmac('sha256', s).update(q).digest('hex'); }

// ============ Factory (23 Agu 2026) ============
// `client`     : hasil binanceExecutor.createBinanceClient({apiKey, apiSecret, testnet}) -- atau
//                default module (akun Olan sendiri, wrapper lama).
// `journalPath`: file JSON journal KHUSUS instance ini (per akun -- beda phone/mode = beda file).
// `sendWA(msg)`: fungsi kirim notifikasi -- default `sendWhatsApp` (fonnte.js, broadcast SEMUA
// grup termasuk Wibowo Hedgefund) -- SENGAJA, jalur default ini kepake buat akun Olan SENDIRI
// (legacy/standalone), dan Olan eksplisit oke posisi dia sendiri (walau demo, jujur dilabelin
// "(Demo)") keliatan di situ -- BEDA kasus dari sniperAutoAnalysis.js (itu teaser publik yang
// BUKAN aktivitas akun beneran siapapun, gak relevan buat shareholder, 3 Sep 2026).
// `getModalBase(marginAsset)`: override sumber modal (saldo Binance live vs live+eksternal) --
//                default null = pakai `client.getAccountBalance(marginAsset)` apa adanya.
// `apiCreds`   : { apiKey, apiSecret, testnet } -- WAJIB kalau mau `fetchRealizedPnlSince` jalan
//                (butuh signed request langsung ke /fapi/v1/income, belum ada di client factory).
// `mexcClient` (BARU, 30 Agu 2026) -- Emas eksekusi ke MEXC sekarang (lihat memori
// project-kaela-multi-exchange), default ke mexcExecutor.js singleton (akun Olan sendiri) kayak
// `client`/binanceExecutorDefault. `execFor(assetCfg)` di bawah milih instance yang bener per aset.
function createNyopetTrader({ client, mexcClient, journalPath, sendWA, getModalBase, apiCreds, onEvent } = {}) {
  const c = client || binanceExecutorDefault;
  const mc = mexcClient || mexcExecutorDefault;
  function execFor(assetCfg) { return assetCfg.exchange === 'mexc' ? mc : c; }
  const jPath = journalPath || DEFAULT_JOURNAL_PATH;
  const notify = sendWA || sendWhatsApp;
  const emit = onEvent || (() => {}); // 23 Agu 2026 -- hook OPSIONAL buat jurnal personal (Kaela Pro
                                       // Trader, multiAccountExecutor.js) -- default no-op, ZERO efek
                                       // samping buat akun Olan sendiri (dia gak butuh hook ini).
  const baseUrl = apiCreds && apiCreds.testnet === false ? 'https://fapi.binance.com' : 'https://demo-fapi.binance.com';
  // 29 Agu 2026: pesan WA dulu HARDCODE "(Binance Demo)" -- gak masalah selama Real belum pernah
  // beneran ngirim pesan, TAPI bakal MENYESATKAN begitu Real jalan (nunjuk "Demo" padahal duit
  // asli). isDemo dipakai formatAutoOpen/formatAutoClosed biar labelnya selalu bener.
  const isDemo = !(apiCreds && apiCreds.testnet === false);

  function loadJournal() {
    if (!fs.existsSync(jPath)) return { balanceUsdc: 0, balanceUsdt: 0, orders: [], watchZoneByAsset: {} };
    const j = JSON.parse(fs.readFileSync(jPath, 'utf8'));
    let migrated = false;
    for (const o of j.orders || []) {
      if (!o.asset) { o.asset = 'btc'; migrated = true; }
    }
    if (!j.watchZoneByAsset) j.watchZoneByAsset = {};
    if (j.watchZone && !j.watchZoneByAsset.btc) { j.watchZoneByAsset.btc = j.watchZone; migrated = true; }
    if (j.watchZone) { delete j.watchZone; migrated = true; }
    if (migrated) saveJournal(j);
    return j;
  }
  function saveJournal(j) {
    fs.writeFileSync(jPath, JSON.stringify(j, null, 2));
  }
  function getFloatingOrder(journal, assetKey) {
    return (journal.orders || []).find((o) => o.status === 'floating' && o.asset === assetKey) || null;
  }

  // exchange param (30 Agu 2026, migrasi Emas ke MEXC) -- default 'binance' biar SEMUA caller lama
  // (BTC, atau siapapun yang belum sempat update panggilannya) ZERO PERUBAHAN PERILAKU.
  async function fetchLivePrice(symbol, exchange = 'binance') {
    if (exchange === 'mexc') {
      const res = await fetch(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${symbol}`);
      const json = await res.json();
      return parseFloat(json.data.lastPrice);
    }
    const res = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`);
    return parseFloat((await res.json()).price);
  }

  // Income history (realized PNL asli dari Binance) -- WAJIB dipakai buat rekonsiliasi kalau
  // posisi ternyata udah closed/likuidasi SELAMA kita offline, JANGAN pernah nebak PNL dari harga.
  async function fetchRealizedPnlSince(symbol, startTime) {
    const creds = apiCreds || (function () { const s = require('./secrets'); return { apiKey: s.BINANCE_API_KEY, apiSecret: s.BINANCE_API_SECRET }; })();
    const params = { symbol, startTime, timestamp: Date.now(), recvWindow: 15000, limit: 1000 }; // recvWindow dinaikin, lihat catatan binanceExecutor.js
    const query = new URLSearchParams(params).toString();
    const sig = sign(query, creds.apiSecret);
    const res = await fetch(`${baseUrl}/fapi/v1/income?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': creds.apiKey } });
    const income = await res.json();
    return income.reduce((s, inc) => s + parseFloat(inc.income), 0);
  }

  async function resolveModal(marginAsset, exec) {
    if (getModalBase) {
      const override = await getModalBase(marginAsset);
      if (override != null) return override;
    }
    return (exec || c).getAccountBalance(marginAsset);
  }

  // Buka posisi beneran + tulis ke journal (status floating) + kirim notif.
  // `sig`: { direction, sl, patternType } dari detectPatternSignal/detectFvgSignal -- SL di sini
  // WAJIB dari struktur pola (bukan liquidation-implied lagi), TP tahap 1 dihitung 2R dari situ.
  async function openPosition(assetCfg, sig, livePriceIn) {
    const { symbol, marginAsset, key: assetKey } = assetCfg;
    const exec = execFor(assetCfg); // Binance buat BTC, MEXC buat Emas (lihat memori project-kaela-multi-exchange)
    const [modalFull, livePrice] = await Promise.all([resolveModal(marginAsset, exec), livePriceIn != null ? Promise.resolve(livePriceIn) : fetchLivePrice(symbol, assetCfg.exchange)]);
    const modal = modalFull * MODAL_ACTIVE_FRACTION;
    const riskDistance = Math.abs(livePrice - sig.sl);
    if (riskDistance === 0) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: SL sama persis harga entry (riskDistance=0), skip sinyal ini.`); return null; }
    const calc = hitungExposure({ modal, entry: livePrice, stopLoss: sig.sl });
    const partialTp = sig.direction === 'buy' ? livePrice + riskDistance * PARTIAL_RR : livePrice - riskDistance * PARTIAL_RR;
    console.log(`[NyopetAutoTrader] ${assetCfg.label}: Saldo ${marginAsset} penuh $${modalFull.toFixed(2)} -> modal aktif (1/5) $${modal.toFixed(2)} | nyawa ${(riskDistance / livePrice * 100).toFixed(2)}% -> leverage ${calc.leverage}x | pattern=${sig.patternType}`);

    await exec.setIsolatedMargin(symbol);
    await exec.setLeverage(symbol, calc.leverage);
    let entryOrder;
    try {
      entryOrder = await exec.placeMarketEntry({ symbol, direction: sig.direction, notionalUsd: calc.nilaiPosisi, livePrice });
    } catch (e) {
      // 24 Agu 2026, permintaan Olan: member REAL yang sinyalnya kelewat krn saldo kurang WAJIB
      // dikasih tau (bukan cuma nyampah di log lokal) -- Demo gak usah (solusinya beda, reset
      // Testnet, bukan isi saldo beneran).
      if (apiCreds && apiCreds.testnet === false && isInsufficientBalanceError(e.message)) {
        const alertKey = `${path.basename(journalPath, '.json')}-nyopet-${assetCfg.label}`;
        if (shouldAlertInsufficientBalance(alertKey)) {
          await notify(formatInsufficientBalanceAlert({ strategy: 'Nyopet', assetLabel: assetCfg.label, direction: sig.direction, entry: livePrice, tp: partialTp }));
        }
      }
      throw e;
    }
    const qty = parseFloat(entryOrder.executedQty);
    const entryPrice = parseFloat(entryOrder.avgPrice);

    const order = {
      id: 'nyopet-demo-' + Date.now(), asset: assetKey, exchange: assetCfg.exchange, direction: sig.direction, status: 'floating',
      mode: sig.patternType, patternType: sig.patternType, entryPrice,
      sl: sig.sl, originalSl: sig.sl, tp: partialTp, partialTp, qty,
      leverage: calc.leverage, marginUsd: calc.margin, nilaiPosisi: calc.nilaiPosisi,
      partialDone: false, remainingFraction: 1, realizedPnlUsd: 0,
      triggeredAt: new Date().toISOString(),
      // 3 Sep 2026, permintaan Olan ("kasih alasan buka posisi bagi Olan, kolom text di web") --
      // CUMA keisi kalau sig.patternType==='manual' (dari checkManualOpenRequest.js, teks yang
      // Olan ketik di popup alasan web). null buat sinyal OTOMATIS -- formatAutoOpen ambil alasan
      // dari pattern (patternReason) di kasus itu, bukan dari field ini.
      manualReason: sig.manualReason || null,
    };
    const journal = loadJournal();
    journal.orders.push(order);
    saveJournal(journal);

    const dxyLine = await formatDxyLine().catch(() => '');
    const msg = formatAutoOpen({ ...order, assetLabel: assetCfg.label }, new Date(), dxyLine, isDemo);
    console.log(msg + '\n');
    await notify(msg);
    emit({ entryId: order.id, type: 'open', strategy: 'nyopet', asset: assetKey, exchange: assetCfg.exchange, direction: sig.direction, entryPrice, sl: sig.sl, tp: partialTp, leverage: calc.leverage, marginUsd: calc.margin, status: 'open', openedAt: order.triggeredAt, note: `Chart Pattern/FVG (${sig.patternType})` });
    return order;
  }

  // Tahap 1 (30 Agu 2026, Nyopet v2) -- tutup SEPARUH posisi begitu 2R kesentuh, kunci untung
  // sebagian, geser SL sisanya ke breakeven (entry) -- SAMA persis pola Sniper (sniperOrderMonitor.js),
  // via market order sebagian (BUKAN placed conditional order -- lihat catatan di kepala file).
  async function closePartial(assetCfg, order, exitPrice) {
    const { symbol } = assetCfg;
    const exec = execFor(assetCfg);
    const partialQty = order.qty * 0.5;
    const closeOrder = await exec.emergencyCloseMarket({ symbol, direction: order.direction, quantity: partialQty });
    const filledExit = parseFloat(closeOrder.avgPrice) || exitPrice;
    const realizedPnlUsd = order.direction === 'buy' ? (filledExit - order.entryPrice) * partialQty : (order.entryPrice - filledExit) * partialQty;

    const journal = loadJournal();
    const target = journal.orders.find((o) => o.id === order.id);
    Object.assign(target, { partialDone: true, remainingFraction: 0.5, sl: order.entryPrice, realizedPnlUsd, partialClosedAt: new Date().toISOString() });
    saveJournal(journal);

    const msg = formatAutoPartial({ ...target, assetLabel: assetCfg.label }, new Date(), isDemo);
    console.log(msg + '\n');
    await notify(msg);
    emit({ entryId: order.id, type: 'partial', realizedPnlUsd, sl: order.entryPrice, exchange: assetCfg.exchange });
    return target;
  }

  // `reason`: 'SL' (kena SL sebelum partial) | 'SL_BREAKEVEN' (sisa posisi kena SL=entry abis
  // partial) | 'TRAIL' (momentum patah, trailing SMA) | 'MANUAL'. `alreadyClosed`=true dipanggil
  // dari rekonsiliasi income-history (posisi kelikuidasi/closed di luar sepengetahuan kita).
  async function closePosition(assetCfg, order, { alreadyClosed, realPnlUsd, reason, manualNote }) {
    const { symbol } = assetCfg;
    const exec = execFor(assetCfg);
    const remainingQty = order.qty * (order.remainingFraction != null ? order.remainingFraction : 1);
    let legPnlUsd, exitPrice, reconciliationNote;
    if (alreadyClosed) {
      // 28 Agu 2026, bug nyata: `fetchRealizedPnlSince` jumlahin SEMUA income simbol ini sejak
      // triggeredAt -- kalau eksekutor mati lama (komputer sleep berjam-jam) dan simbol yang sama
      // kepake trade LAIN (akun ini numpang banyak eksperimen), hasilnya kebablasan jauh dari
      // margin yang beneran dipasang. Isolated margin GAK MUNGKIN rugi lebih dari margin sendiri --
      // clamp ke -marginUsd persis (pola sama kayak [[project-dark-kaela]] Dark Kaela lama) kalau
      // hasil mentahnya gak masuk akal, JANGAN percaya buta angka fetchRealizedPnlSince.
      const maxLoss = -(order.marginUsd * (order.remainingFraction != null ? order.remainingFraction : 1));
      if (realPnlUsd < maxLoss) {
        reconciliationNote = `PnL mentah dari income history ($${realPnlUsd.toFixed(2)}) gak masuk akal (isolated margin max rugi $${maxLoss.toFixed(2)}) -- kemungkinan kecampur aktivitas simbol lain pas eksekutor offline lama. Di-clamp ke -marginUsd.`;
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: ${reconciliationNote}`);
        legPnlUsd = maxLoss;
      } else {
        legPnlUsd = realPnlUsd;
      }
      exitPrice = remainingQty > 0 ? (order.direction === 'buy' ? order.entryPrice + legPnlUsd / remainingQty : order.entryPrice - legPnlUsd / remainingQty) : order.entryPrice;
    } else {
      const closeOrder = await exec.emergencyCloseMarket({ symbol, direction: order.direction, quantity: remainingQty });
      // ⚠️ BUG BAHAYA ketemu+fix 3 Sep 2026 (Olan: "dipertanyakan apa itu -300 dolar!" -- posisi
      // REAL untung +$3.84 asli di Binance, tapi WA ngirim "-$306.94" -- kesalahan MURNI di sini,
      // BUKAN kerugian beneran). Root cause: `closeOrder.avgPrice` kadang balik "0"/kosong sesaat
      // (order market BARU submit, belum sempat fill KETIKA respons balik -- sama kelas bug yang
      // udah difix buat ENTRY via waitForFill di binanceExecutor.js, tapi emergencyCloseMarket
      // TERNYATA gak punya penjamin yang sama). Fallback LAMA `|| order.sl` FATAL kalau order.sl
      // null (posisi "legacy"/direkonstruksi manual, gak ada SL asli tercatat) -- exitPrice jadi
      // null, null-0 di aritmatika JS jadi 0, PnL keitung dari "exit $0" (rugi 100% harga entry).
      // Fix: kalau avgPrice gak kebaca, JANGAN nebak dari field lain -- tanya harga LIVE SEKARANG
      // (real, bukan fallback ngarang), dan PnL dari situ MASUK AKAL (mendekati unrealized profit
      // yang keliatan sebelum ditutup), BUKAN entry-ke-nol yang mustahil buat market order normal.
      let avgPrice = parseFloat(closeOrder.avgPrice);
      if (!avgPrice) {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: closeOrder.avgPrice gak kebaca ("${closeOrder.avgPrice}") -- ambil harga live SEKARANG buat exitPrice, JANGAN fallback ke order.sl (bisa null/nyesatin).`);
        avgPrice = await fetchLivePrice(symbol, assetCfg.exchange);
      }
      exitPrice = avgPrice;
      legPnlUsd = order.direction === 'buy' ? (exitPrice - order.entryPrice) * remainingQty : (order.entryPrice - exitPrice) * remainingQty;
    }
    const totalPnlUsd = (order.realizedPnlUsd || 0) + legPnlUsd;
    const pnlPct = (totalPnlUsd / order.marginUsd) * 100;
    const won = totalPnlUsd >= 0;

    const journal = loadJournal();
    const target = journal.orders.find((o) => o.id === order.id);
    Object.assign(target, { status: won ? 'closed_tp' : 'closed_sl', exitPrice, pnlUsd: totalPnlUsd, pnlPct, closeReason: reason, closedAt: new Date().toISOString() });
    if (reconciliationNote) target.reconciliationNote = reconciliationNote;
    saveJournal(journal);

    // 3 Sep 2026, permintaan Olan ("alasan boleh saat pencet.. tutup posisi") -- alasan TUTUP:
    // manual (Olan) pakai teks yang DIA TULIS di popup web (`manualNote`, sekarang isinya teks
    // asli, bukan lagi kalimat generik "Ditutup MANUAL atas permintaan X" -- lihat forceClosePosition),
    // otomatis pakai CLOSE_REASON_LABEL (mapping kode->teks manusia).
    const alasanText = manualNote || CLOSE_REASON_LABEL[reason] || reason || '-';
    const msg = formatAutoClosed({ id: order.id, direction: order.direction === 'buy' ? 'long' : 'short', mode: order.mode, entryPrice: order.entryPrice, exitPrice, pnlUsd: totalPnlUsd, pnlPct, assetLabel: assetCfg.label }, new Date(), isDemo, alasanText);
    console.log(msg + '\n');
    await notify(msg);
    emit({ entryId: order.id, type: 'close', status: 'closed', pnlUsd: target.pnlUsd, closedAt: target.closedAt, exchange: assetCfg.exchange });
    return target;
  }

  async function processAsset(assetCfg) {
    const { symbol, zoneSymbol, key: assetKey } = assetCfg;
    const exec = execFor(assetCfg);
    const journal = loadJournal();
    const floating = getFloatingOrder(journal, assetKey);

    if (floating) {
      // ⚠️ BUG ketemu 30 Agu 2026 (dari laporan watchdog "Cannot read properties of null") --
      // beda perilaku Binance vs MEXC: Binance getPositionRisk BIASANYA tetap balikin object
      // (positionAmt="0") walau posisi flat, tapi MEXC open_positions cuma balikin posisi yang
      // BENERAN aktif -- gak ada = null. Kode lama asumsi selalu ada object, crash pas null.
      const posRisk = await exec.getPositionRisk(symbol);
      const stillOpen = posRisk ? Math.abs(parseFloat(posRisk.positionAmt)) > 0 : false;

      if (!stillOpen) {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: posisi UDAH GAK ADA (kelikuidasi/offline) -- rekonsiliasi income history.`);
        // ⚠️ fetchRealizedPnlSince HARDCODE Binance (signing+endpoint /fapi/v1/income) -- BELUM
        // ada versi MEXC (riset endpoint income-history MEXC belum dilakuin, 30 Agu 2026). Gagal
        // JELAS di sini drpd diem-diem manggil endpoint Binance pakai simbol MEXC (bisa salah data).
        if (assetCfg.exchange === 'mexc') {
          throw new Error(`Rekonsiliasi posisi ${assetCfg.label} (MEXC) yang kelikuidasi offline BELUM DIDUKUNG -- fetchRealizedPnlSince cuma ada versi Binance. Cek manual dulu di MEXC.`);
        }
        const realPnlUsd = await fetchRealizedPnlSince(symbol, new Date(floating.partialClosedAt || floating.triggeredAt).getTime());
        await closePosition(assetCfg, floating, { alreadyClosed: true, realPnlUsd, reason: 'OFFLINE' });
        return;
      }

      const livePrice = await fetchLivePrice(symbol, assetCfg.exchange);

      // ⚠️ BUG KRITIS ketemu 31 Agu 2026 (posisi REAL Olan BTCUSDC sell, dibuka 28 Agu SEBELUM
      // rewrite v2 -- skema LAMA liqPrice/tp/zonePrice, GAK PUNYA field sl/partialTp sama sekali).
      // hitSl/hitPartial di bawah baca floating.sl/floating.partialTp -- `livePrice >= undefined`
      // SELALU false di JS, jadi posisi lama ini JADI ORPHAN, gak pernah bisa ke-exit otomatis lagi
      // walau harga udah lewat jauh dari liqPrice aslinya. Fix: kalau floating.sl gak ada, posisi
      // ini LEGACY -- tutup PENUH (bukan partial, itu bukan desain skema lama) begitu kena liqPrice
      // ATAU tp, PERSIS logika single-TP/SL yang berlaku pas posisi ini dibuka.
      if (floating.sl == null) {
        // ⚠️ BUG BAHAYA ketemu+fix 3 Sep 2026 (Olan: "dipertanyakan apa itu -300 dolar!") -- komentar
        // di atas ("livePrice >= undefined SELALU false") CUMA bener kalau field-nya kebener KOSONG
        // (undefined, property gak pernah ke-set). Tapi kalau field-nya di-set EXPLICIT `null` (kejadian
        // nyata: posisi direkonstruksi manual dari live position, `tp` sengaja null krn gak tau TP
        // aslinya) -- `livePrice >= null` di JS itu `livePrice >= 0`, SELALU TRUE buat harga real
        // manapun! Posisi ke-anggap "TP kena" instan di cek PERTAMA, ditutup market order asal-asalan.
        // Fix: guard EKSPLISIT `!= null` (nangkep null MAUPUN undefined) sebelum bandingin harga --
        // liqPrice/tp yang gak ada/null artinya "gak tau, JANGAN pernah anggap kena".
        const legacyHitSl = floating.liqPrice != null && (floating.direction === 'buy' ? livePrice <= floating.liqPrice : livePrice >= floating.liqPrice);
        const legacyHitTp = floating.tp != null && (floating.direction === 'buy' ? livePrice >= floating.tp : livePrice <= floating.tp);
        if (legacyHitSl || legacyHitTp) {
          console.log(`[NyopetAutoTrader] ${assetCfg.label}: posisi LEGACY (pre-v2) kena ${legacyHitSl ? 'liq/SL' : 'TP'} (${livePrice}) -- tutup penuh.`);
          await closePosition(assetCfg, floating, { alreadyClosed: false, reason: legacyHitSl ? 'SL' : 'MANUAL', manualNote: 'Posisi legacy pre-v2, exit tunggal liq/tp (skema lama, gak ikut partial/trail v2).' });
          return;
        }
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: posisi LEGACY (pre-v2) masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}, liq ${floating.liqPrice}, TP ${floating.tp}) -- lanjut pantau (skema lama).`);
        return;
      }

      if (!floating.partialDone) {
        const hitSl = floating.direction === 'buy' ? livePrice <= floating.sl : livePrice >= floating.sl;
        const hitPartial = floating.direction === 'buy' ? livePrice >= floating.partialTp : livePrice <= floating.partialTp;
        if (hitSl) {
          console.log(`[NyopetAutoTrader] ${assetCfg.label}: SL kena (${livePrice} vs SL ${floating.sl}) sebelum sempat partial -- tutup rugi penuh.`);
          await closePosition(assetCfg, floating, { alreadyClosed: false, reason: 'SL' });
          return;
        }
        if (hitPartial) {
          console.log(`[NyopetAutoTrader] ${assetCfg.label}: tahap 1 (2R) kena (${livePrice} vs ${floating.partialTp}) -- amankan separuh, SL sisa geser breakeven.`);
          await closePartial(assetCfg, floating, livePrice);
          return;
        }
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: masih floating (${floating.direction} @ ${floating.entryPrice}, sekarang ${livePrice}, SL ${floating.sl}, TP1 ${floating.partialTp}) -- lanjut pantau.`);
        return;
      }

      // Udah partial -- SL sekarang breakeven (floating.sl == entryPrice), pantau itu + trailing SMA.
      const hitBreakevenSl = floating.direction === 'buy' ? livePrice <= floating.sl : livePrice >= floating.sl;
      let trailBroken = false;
      if (!hitBreakevenSl) {
        const candles4hForTrail = await fetchCandles4hPaginated(zoneSymbol, TRAIL_SMA_LEN_4H + 5);
        const closes = candles4hForTrail.map((c) => c.close);
        const trailSma = sma(closes, TRAIL_SMA_LEN_4H);
        if (trailSma !== null) trailBroken = floating.direction === 'buy' ? livePrice < trailSma : livePrice > trailSma;
      }
      if (!hitBreakevenSl && !trailBroken) {
        console.log(`[NyopetAutoTrader] ${assetCfg.label}: sisa posisi (partial done) masih floating -- lanjut pantau.`);
        return;
      }
      console.log(`[NyopetAutoTrader] ${assetCfg.label}: ${hitBreakevenSl ? 'SL breakeven kena' : 'trailing SMA patah'} -- tutup sisa posisi.`);
      await closePosition(assetCfg, floating, { alreadyClosed: false, reason: hitBreakevenSl ? 'SL_BREAKEVEN' : 'TRAIL' });
      return;
    }

    // ⚠️ BUG BAHAYA ketemu+fix 3 Sep 2026 (Olan nyoba buka posisi manual, GAGAL "Leverage
    // reduction is not supported... with open positions") -- journal LOKAL bilang gak ada floating
    // (getFloatingOrder null), TAPI Binance BENERAN punya posisi kebuka (leverage beda dari yang
    // mau dipasang). Root cause: multi-account-state/ SENGAJA gak disinkron git (data PERSONAL,
    // lihat .gitignore) -- begitu leader pindah mesin (komputer-utama -> vultr-sg, 2 Sep 2026),
    // journal lokal mesin BARU "lupa total" posisi yang tercatat cuma di mesin LAMA, padahal
    // posisi ASLINYA di Binance tetap ada. Tanpa cek ini, siklus normal BISA nyoba buka sinyal
    // baru di atas posisi yang udah ada -- bentrok leverage (gagal, untung SAFE) ATAU labih parah
    // nambah size gak sengaja kalau kebetulan leverage-nya sama. Fix: SELALU cek live position
    // Binance/MEXC dulu SEBELUM nyimpulkan "gak ada posisi" -- kalau ternyata ADA (journal lokal
    // yang salah), SKIP total siklus ini (jangan coba apa-apa) daripada eksekusi ngawur.
    const liveCheckPos = await exec.getPositionRisk(symbol).catch(() => null);
    if (liveCheckPos && Math.abs(parseFloat(liveCheckPos.positionAmt)) > 0) {
      console.log(`[NyopetAutoTrader] ${assetCfg.label}: ⚠️ ADA posisi live di exchange (entry ${liveCheckPos.entryPrice}) yang GAK kecatat di journal lokal mesin ini (kemungkinan abis pindah leader) -- SKIP cari sinyal baru siklus ini, journal PERLU direkonsiliasi.`);
      return;
    }

    // ============ Gak ada posisi floating -- cari sinyal baru (chart pattern -> FVG, long-only, 4H) ============
    const candles4h = await fetchCandles4hPaginated(zoneSymbol, CANDLES_NEEDED_4H);
    if (candles4h.length < 300) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: candle 4H belum cukup (${candles4h.length}), skip siklus ini.`); return; }
    const i = candles4h.length - 1;

    let sig = detectPatternSignal(candles4h, i, PATTERN_PARAMS_4H);
    if (!sig) {
      const fvgSig = detectFvgSignal(candles4h, i, { slBufferPct: PATTERN_PARAMS_4H.slBufferPct, trendSmaLen: FVG_TREND_SMA_LEN_4H });
      if (fvgSig) sig = fvgSig;
    }
    if (!sig) { console.log(`[NyopetAutoTrader] ${assetCfg.label}: belum ada sinyal (flag/wedge/FVG) -- tunggu siklus depan.`); return; }

    // Konfirmasi DXY (31 Agu 2026, permintaan Olan: "setiap entry juga diyakinkan dengan dxy")
    // -- KHUSUS Nyopet (lolos 2 tes ketat: split era + sensitivitas parameter, lihat backtest/
    // dxySniperScrutiny.js vs dxyNyopetScrutiny.js). Sniper SENGAJA TIDAK dikasih ini (gagal di
    // dua tes yang sama). null (fetch DXY gagal) = treat LOLOS, jangan block trading gara2 DXY
    // down -- ini konfirmasi TAMBAHAN, bukan syarat mutlak.
    const dxyWeak = await isDxyWeak(20).catch(() => null);
    if (dxyWeak === false) {
      console.log(`[NyopetAutoTrader] ${assetCfg.label}: sinyal ${sig.patternType} ketemu TAPI DXY lagi kuat (dolar menguat) -- skip, tunggu konfirmasi dolar lemah.`);
      return;
    }

    await openPosition(assetCfg, sig, candles4h[i].close);
  }

  async function main() {
    for (const assetCfg of Object.values(NYOPET_ASSETS)) {
      try {
        await processAsset(assetCfg);
      } catch (e) {
        console.log(`[NyopetAutoTrader] ERROR ${assetCfg.label}:`, e.message);
      }
    }
    await syncBalances();
  }

  // Sinkron saldo LIVE tiap siklus (29 Agu 2026, bug ketemu: journal.balance cuma keupdate pas
  // openPosition() -- begitu udah gak ada posisi baru dibuka, angkanya STALE mulu, beda dari
  // Sniper yang emang disinkron tiap siklus di localLiveExecutor.js).
  //
  // 30 Agu 2026, migrasi Emas ke MEXC -- BTC (USDC/Binance) dan Emas (MEXC) sekarang 2
  // EXCHANGE BEDA, bukan cuma 2 asset margin beda di Binance yang sama. `journal.balanceUsdc`/
  // `balanceUsdt` DIPERTAHANKAN (nama lama, backward-compat -- dashboard/notif lama masih baca
  // field ini) TAPI sekarang diisi PER-ASSET pakai exec yang bener (`execFor`), bukan 1 client
  // buat dua-duanya lagi. Kalau MEXC belum disetup, saldo MEXC gagal SENDIRI (try/catch per
  // asset) -- BTC/USDC (Binance) TETAP sinkron normal, gak ikut gagal bareng.
  //
  // BUG ketemu 30 Agu 2026 (sore) -- pas Nyopet Emas dipindah ke margin USDC (PAXG_USDC, biar
  // TRUE 4 dompet sama pola Binance), field-nya JADI TABRAKAN sama Nyopet BTC (BTCUSDC) -- dua-
  // duanya marginAsset='USDC' tapi EXCHANGE beda (Binance vs MEXC), kalau cuma dikunci nama
  // marginAsset doang ('balanceUsdc') satu nimpa satunya (yang jalan belakangan menang). FIX:
  // field dikunci exchange+marginAsset -- Binance TETAP 'balanceUsdc'/'balanceUsdt' (nama lama,
  // dibaca jurnal publik/dashboard.html), MEXC pakai 'mexcBalanceUsdc'/'mexcBalanceUsdt' (SAMA
  // pola nama kayak multiAccountExecutor.js/Sheet.gs member-status, biar konsisten 1 sistem).
  async function syncBalances() {
    const journal = loadJournal();
    for (const assetCfg of Object.values(NYOPET_ASSETS)) {
      try {
        const bal = await execFor(assetCfg).getAccountBalance(assetCfg.marginAsset);
        const capMargin = assetCfg.marginAsset.charAt(0) + assetCfg.marginAsset.slice(1).toLowerCase(); // USDC -> Usdc, USDT -> Usdt
        const field = (assetCfg.exchange === 'mexc' ? 'mexcBalance' : 'balance') + capMargin;
        journal[field] = bal;
      } catch (e) {
        console.log(`[NyopetAutoTrader] Gagal sinkron saldo ${assetCfg.label} (${assetCfg.exchange}):`, e.message);
      }
    }
    delete journal.balance; // field lama ambigu (USDT/USDC ketuker tergantung aset mana yang terakhir buka posisi) -- dibuang, ganti field per-asset eksplisit di atas
    saveJournal(journal);
  }

  // 28 Agu 2026, permintaan Olan: "user pengen fasilitas tutup posisi dari Kaela Access, aku
  // sebagai master juga diizinkan bantu buka/tutup posisi member" -- dipanggil dari
  // multiAccountExecutor.js kalau ada antrian di Sheet CloseRequests (lihat Sheet.gs) yang cocok
  // sama akun ini. `requestedBy` cuma buat catatan/fallback (siapa yang minta tutup). `reason`
  // (BARU, 3 Sep 2026) -- teks alasan yang Olan TULIS SENDIRI di popup web (self-close, lihat
  // dashboard.html) -- kalau diisi, ini yang jadi "Alasan:" di pesan WA (bukan kalimat generik).
  // "Tutup Posisi Client" (admin nutupin MEMBER LAIN) TETAP gak ngirim `reason` -- fallback
  // generik di bawah TETAP jalan buat jalur itu, SENGAJA gak diubah (dikonfirmasi scope Olan).
  async function forceClosePosition(assetKey, requestedBy, reason) {
    const assetCfg = Object.values(NYOPET_ASSETS).find((a) => a.key === assetKey);
    if (!assetCfg) return { ok: false, error: `Asset "${assetKey}" gak dikenal.` };
    const journal = loadJournal();
    const order = getFloatingOrder(journal, assetKey);
    if (!order) return { ok: false, error: `Gak ada posisi floating buat ${assetCfg.label}.` };

    const manualNote = reason || (requestedBy ? `Ditutup manual atas permintaan ${requestedBy}` : 'Ditutup manual');
    await closePosition(assetCfg, order, { alreadyClosed: false, reason: 'MANUAL', manualNote });
    return { ok: true };
  }

  // 3 Sep 2026, permintaan Olan: "aku senior tradernya.. mau bisa backup Kaela Nyopet, buka posisi
  // manual dari web" -- openPosition DIEXPOSE (dulu cuma dipakai internal processAsset abis
  // detectPatternSignal/detectFvgSignal) biar bisa dipanggil LANGSUNG dari checkManualOpenRequest.js
  // dengan `sig` buatan tangan (direction+sl dari Olan, patternType='manual') -- exposure/leverage/
  // size TETAP lewat hitungExposure yang SAMA (permintaan Olan: "wajib lewat kalkulator exposure",
  // BUKAN size bebas), cuma arah+SL yang Olan tentuin sendiri (buy & sell dua-duanya diizinkan buat
  // manual -- KEPUTUSAN SADAR beda dari bot yang buy-only, dikonfirmasi Olan 3 Sep 2026 lewat
  // AskUserQuestion, BUKAN diam-diam nyalain short).
  // fetchLivePrice diexpose juga (3 Sep 2026) -- checkManualOpenRequest.js butuh harga live buat
  // konversi "Nyawa %" -> harga SL ASLI SEBELUM manggil openPosition (biar SL dihitung dari harga
  // yang SAMA kayak yang dipakai buat entry, bukan 2 fetch beda waktu yang bisa geser dikit).
  return { processAsset, main, loadJournal, getFloatingOrder, forceClosePosition, syncBalances, openPosition, fetchLivePrice };
}

// ============ Wrapper backward-compatible (akun Olan sendiri) -- ZERO perubahan perilaku, path
// journal SAMA (nyopet-journal.json), kredensial/WA SAMA (binanceExecutor default + fonnte.js). ============
// BUG ketemu 3 Sep 2026: createNyopetTrader({}) TANPA onEvent -- Demo Olan lewat jalur INI (bukan
// multiAccountExecutor.js, yang SENGAJA skip Demo Olan, lihat catatan di file itu) gak PERNAH
// nulis ke Sheet Journal GAS, padahal tab "Jurnal Demo" (Kaela Access, keliatan buat semua
// anggota) baca dari situ -- selamanya kosong walau posisi Demo beneran jalan. Fix: kasih onEvent
// yang nulis Journal khusus buat Olan (MASTER_NOMOR, mode 'demo') -- SAMA pola kayak
// buildJournalHook di multiAccountExecutor.js, direplikasi di sini krn jalur ini independen.
const MASTER_NOMOR = '6281299303888'; // sama persis multiAccountExecutor.js -- bukan secret, ID member.
function _journalHookOlanDemo(evt) {
  const kaela = require('./kaelaProTraderClient');
  if (evt.type === 'open') {
    kaela.recordJournalEntry(MASTER_NOMOR, 'demo', {
      entryId: evt.entryId, strategy: evt.strategy, asset: evt.asset, direction: evt.direction,
      entryPrice: evt.entryPrice, sl: evt.sl, tp: evt.tp, leverage: evt.leverage, marginUsd: evt.marginUsd,
      status: 'open', openedAt: evt.openedAt, note: evt.note || '',
    }).catch((e) => console.log('[NyopetAutoTrader] recordJournalEntry (demo Olan) gagal:', e.message));
  } else if (evt.type === 'close') {
    kaela.updateJournalEntry(evt.entryId, { status: 'closed', closedAt: evt.closedAt, pnlUsd: evt.pnlUsd })
      .catch((e) => console.log('[NyopetAutoTrader] updateJournalEntry (demo Olan) gagal:', e.message));
  }
}
const _defaultTrader = createNyopetTrader({ onEvent: _journalHookOlanDemo });

async function main() {
  if (!isLiveTradingEnabled()) {
    console.log('[NyopetAutoTrader] Kill switch OFF -- gak ngapa-ngapain.');
    return;
  }
  await _defaultTrader.main();
}

module.exports = { createNyopetTrader, main };

if (require.main === module) {
  main().catch((e) => { console.error('ERROR nyopetAutoTrader.js:', e.message); process.exit(1); });
}
