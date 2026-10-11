// gridTrader.js (10 Okt 2026) -- 🕸️ GRID ATH BTC-USDC di BingX Perpetual, REAL langsung (keputusan Olan: "grid gak usah demo,
// backtest cukup, secara matematika oke"). Riset: backtest/gridLab.js (data 1 jam 2017-26, 94 titik mulai, compound).
//
// ATURAN OLAN (persis):
//   1. Deteksi ATH terakhir BTC. Syarat entry: harga <= ATH -15% (minDd).
//   2. Masuk = porsi sesuai kedalaman: tiap 1% di bawah ATH = 1% MODAL GRID (k). Mulai di ATH -34% -> langsung tanam 34%.
//   3. Turun lagi -> auto rebuy tiap level (step 1%) pakai ukuran yang sama.
//   4. Untung bersih >= 15% dari MODAL YANG DITANAM -> tutup SEMUA, siklus selesai.
//   5. Ulang langsung dari acuan ATH (selama masih <= ATH -15%). Modal grid = ekuitas akun saat siklus mulai -> COMPOUND.
//   Volume per level = modal ditanam x pengali (default 1x = tanpa leverage berlebih; eksposur maks <= capExposure x ekuitas).
//   Backtest aturan persis ini (CYCLE step1 k1 x1 TP15): CAGR median ~15%/th, DD terburuk ~59%, gak pernah hangus.
//
// Eksekusi: 1 posisi LONG BTC-USDC CROSS (hedge mode BingX), market order tiap level kesentuh (cek tiap menit dari cron
// run-channel-breakout-vultr.sh). Level yang ukurannya di bawah minimum order (0,0001 BTC) DITUMPUK ke level berikutnya.
// Jurnal: grid-journal.json (git, STATE_FILES). Pesan: Wibowo Hedgefund (real) pakai template darkKaelaLog (SYSTEM_LABEL.GRID).
// Pengaman: posisi di exchange beda dari jurnal -> STOP + lapor (gak nebak/gak nutup posisi orang). Saklar: grid-config.json.
// Uji: node gridTrader.selftest.js (exchange PALSU).

const fs = require('fs');
const path = require('path');

// 11 Okt 2026: `node gridTrader.js demo` = Farmer DEMO di akun BingX VST (BTC-USDT, config/jurnal sendiri), sesuai disiplin demo.
const DEMO = process.argv[2] === 'demo';
const CONFIG_PATH = path.join(__dirname, DEMO ? 'grid-demo-config.json' : 'grid-config.json');
const JOURNAL_PATH = path.join(__dirname, DEMO ? 'grid-demo-journal.json' : 'grid-journal.json');
const TAKER = 0.0005;
const OLAN_PRIBADI = '6282134510686';

function loadConfig() {
  const def = { enabled: false, allowReal: false, symbol: 'BTC-USDC', marginAsset: 'USDC', minDd: 15, step: 1, k: 1, tp: 15, volMult: [{ fromDd: 0, x: 1 }], capExposure: 2, leverage: 5, minCap: 0 };
  try { return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; } catch { return def; }
}
function freshJournal() { return { ath: null, athAt: null, cycle: null, history: [], stats: { cycles: 0, wins: 0, losses: 0, totalPnlUsd: 0 }, seq: { day: null, n: 0 }, alerts: {} }; }
function loadJournal() { try { return { ...freshJournal(), ...JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) }; } catch { return freshJournal(); } }
function saveJournal(j) { fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2)); }

const multAt = (cfg, ddPct) => { let x = 1; for (const m of cfg.volMult || []) if (ddPct >= m.fromDd) x = m.x; return x; };
const fmt$ = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// ================= 1 siklus cek (deps disuntik biar bisa dites) =================
// deps: { cfg, journal, now(), price()->num, athCandidate()->num (high terbaru), exec, notify(msg), alert(msg), log, save(), idr() }
async function runOnce(deps) {
  const { cfg, journal: j } = deps;
  const log = deps.log || ((m) => console.log(`[Grid] ${m}`));
  const now = deps.now ? deps.now() : Date.now();
  if (!cfg.enabled) return { skipped: 'disabled' };
  if (!cfg.allowReal || !deps.exec) return { skipped: 'real off / key kosong' };
  const sym = cfg.symbol, ex = deps.exec;
  if (cfg.mode === 'LADDER') return runLadder(deps, log, now);

  const px = await deps.price();
  const high = await deps.athCandidate().catch(() => null);
  if (!(px > 0)) { log('harga gak kebaca -- skip'); return { skipped: 'no-price' }; }
  const cand = Math.max(high || 0, px);
  if (!(j.ath > 0) || cand > j.ath) { j.ath = cand; j.athAt = now; }
  const dd = (1 - px / j.ath) * 100;

  // ---- rekonsiliasi posisi exchange vs jurnal ----
  const pos = await ex.getPositionBySide(sym, 'LONG');
  const exQty = pos ? Math.abs(parseFloat(pos.positionAmt)) : 0;
  const c = j.cycle;
  const jQty = c ? c.qty : 0;
  if (jQty === 0 && exQty > 0) {
    const msg = `posisi LONG ${sym} ${exQty} ada di exchange tapi jurnal grid kosong -- grid BERHENTI, gak nyentuh posisi itu. Cek manual.`;
    log(msg); await deps.alert(`⚠️ Grid: ${msg}`, 'stray'); deps.save(); return { stopped: 'stray' };
  }
  if (c && jQty > 0 && exQty === 0) {
    log(`posisi grid hilang dari exchange (manual/likuidasi) -- siklus ${c.id} direset`);
    j.history.push({ ...summary(c), closedAt: now, exit: null, grossUsd: null, feeUsd: null, net: null, reason: 'GRID_GONE' });
    j.cycle = null; deps.save();
    await deps.alert(`⚠️ Grid: posisi ${sym} hilang dari exchange (ditutup manual/likuidasi?). Siklus ${c.signalId} direset, PnL gak kebaca.`, 'gone');
    return { gone: true };
  }
  if (c && jQty > 0 && Math.abs(exQty - jQty) / jQty > 0.02) {
    const msg = `qty exchange ${exQty} beda dari jurnal ${jQty.toFixed(4)} -- grid STOP sementara (gak nebak). Cek manual.`;
    log(msg); await deps.alert(`⚠️ Grid: ${msg}`, 'mismatch'); deps.save(); return { stopped: 'mismatch' };
  }

  // ---- TP siklus: untung bersih >= tp% x modal ditanam ----
  if (c && c.qty > 0) {
    const gross = c.qty * px - c.cost, feeClose = c.qty * px * TAKER, net = gross - feeClose - c.feeOpen;
    if (net >= c.planted * cfg.tp / 100) {
      const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'buy', quantity: c.qty });
      const order = o && o.order ? o.order : o;
      const exit = parseFloat(order && order.avgPrice) || px;
      const g2 = c.qty * exit - c.cost, fee2 = c.feeOpen + c.qty * exit * TAKER, n2 = g2 - fee2;
      const rec = { ...summary(c), closedAt: now, exit, grossUsd: g2, feeUsd: fee2, net: n2, retPlantedPct: n2 / c.planted * 100, reason: 'GRID_TP' };
      j.history.push(rec); if (j.history.length > 500) j.history = j.history.slice(-500);
      j.stats.cycles += 1; j.stats.totalPnlUsd += n2; if (n2 >= 0) j.stats.wins += 1; else j.stats.losses += 1;
      j.cycle = null; deps.save();
      log(`TP siklus ${rec.signalId}: ${c.qty.toFixed(4)} BTC ${rec.entry.toFixed(1)} -> ${exit.toFixed(1)} net ${n2.toFixed(2)} (+${rec.retPlantedPct.toFixed(1)}% modal ditanam)`);
      await deps.notify(closeMsg(rec, j, deps));
      return { tp: rec };
    }
  }

  // ---- entry / rebuy ----
  const lvl = Math.floor(dd / cfg.step + 1e-9);
  if (lvl * cfg.step < cfg.minDd) { deps.save(); return { idle: `dd ${dd.toFixed(1)}% < ${cfg.minDd}%` }; }
  let cy = j.cycle;
  const opening = !cy;
  if (opening) {
    const wallet = await ex.getWalletBalance(cfg.marginAsset);
    if (!(wallet > 1)) {
      if (!j.noBalLogAt || now - j.noBalLogAt > 6 * 3600e3) { log(`saldo ${cfg.marginAsset} ${wallet} -- belum bisa mulai siklus (syarat entry udah terpenuhi: ATH -${dd.toFixed(1)}%)`); j.noBalLogAt = now; }
      deps.save(); return { idle: 'no-balance' };
    }
    if (!j.seq || j.seq.day !== new Date(now).toISOString().slice(0, 10)) j.seq = { day: new Date(now).toISOString().slice(0, 10), n: 0 };
    j.seq.n += 1;
    cy = { id: `grid-${now}`, signalId: `G${j.seq.day.replace(/-/g, '')}${String(j.seq.n).padStart(2, '0')}`, startedAt: now, athAtStart: j.ath, cycleCap: wallet, filledLvl: 0, planted: 0, qty: 0, cost: 0, feeOpen: 0, layers: 0, pendingUsd: 0, pendingVol: 0 };
    await ex.setCrossMargin(sym).catch((e) => log(`set cross: ${e.message}`));
    await ex.setLeverage(sym, cfg.leverage, 'LONG').catch((e) => log(`set leverage: ${e.message}`));
  }
  // Top up / tarik modal di tengah siklus (10 Okt 2026, Olan: "sistem nyesuaiin modalku -- top up langsung buka lagi seolah
  // modal udah ada dari awal, jadi aku bisa nyicil"). Saldo wallet (TANPA PnL mengambang) naik > 2% = top up -> modal grid naik
  // & porsi dikejar SEKARANG. Turun > 10% = ditarik -> acuan turun (gak jual apa-apa, cuma gak nambah).
  let topUp = null;
  if (!opening) {
    const wallet = await ex.getWalletBalance(cfg.marginAsset).catch(() => null);
    if (wallet > cy.cycleCap * 1.02) { topUp = { from: cy.cycleCap, to: wallet }; cy.cycleCap = wallet; (cy.topUps = cy.topUps || []).push({ at: now, from: topUp.from, to: wallet }); }
    else if (wallet > 0 && wallet < cy.cycleCap * 0.9) cy.cycleCap = wallet;
  }
  // TARGET porsi = level terdalam yang pernah kesentuh siklus ini x k% x modal grid SEKARANG. Beli kekurangannya: rebuy level baru,
  // kejar top up, dan sisa yang dulu ketumpuk (di bawah minimum order) -- semua otomatis lewat 1 hitungan ini.
  const levelHit = Math.max(lvl, cy.filledLvl);
  // MODAL PATOKAN MINIMAL (10 Okt 2026, Olan: "jangan mengacu pada modal ku yang masih kecil tapi mengacu juga modal minimal,
  // jadi ada minimal cap"). Porsi dihitung dari max(modal grid, minCap) biar rebuy tetap rapat walau saldo kecil; pengamannya
  // tetap capExposure (volume dipotong pas di batas, bukan dilewati).
  const sizeBase = Math.max(cy.cycleCap, cfg.minCap || 0);
  const target = levelHit * cfg.step * cfg.k / 100 * sizeBase;
  const deficit = target - cy.planted;
  if (deficit < cy.cycleCap * 0.001) { cy.filledLvl = levelHit; j.cycle = cy.qty > 0 ? cy : (opening ? null : cy); deps.save(); return { idle: 'porsi udah pas' }; }
  let addVol = deficit * multAt(cfg, levelHit * cfg.step);
  const equity = cy.cycleCap + (cy.qty > 0 ? cy.qty * px - cy.cost : 0);
  const room = cfg.capExposure * Math.max(equity, 0) - cy.qty * px; // sisa ruang eksposur
  if (addVol > room && room > 0) { addVol = room; if (!cy.lastCapLog || now - cy.lastCapLog > 3600e3) { log(`volume dipotong ke batas ${cfg.capExposure}x ekuitas (${fmt$(room)})`); cy.lastCapLog = now; } }
  if ((cy.qty * px + addVol) / Math.max(equity, 1e-9) > cfg.capExposure + 1e-9) {
    log(`eksposur bakal > ${cfg.capExposure}x ekuitas -- level ${levelHit} gak ditambah`);
    cy.filledLvl = levelHit; j.cycle = cy.qty > 0 ? cy : null; deps.save(); return { capped: true };
  }
  const info = await ex.getSymbolInfo(sym);
  const qty = ex.roundToStepSize ? ex.roundToStepSize(addVol / px, info.stepSize, info.quantityPrecision) : Math.floor(addVol / px / info.stepSize) * info.stepSize;
  if (!(qty > 0) || qty * px < (info.minNotionalUsd || 0)) {
    cy.filledLvl = levelHit; j.cycle = cy; deps.save(); // siklus tetap disimpan biar kekurangannya kebawa
    if (!cy.lastPendingLog || now - cy.lastPendingLog > 3600e3) { log(`kurang ${fmt$(addVol)} di bawah minimum order -- ditumpuk sampai cukup`); cy.lastPendingLog = now; deps.save(); }
    return { pending: addVol };
  }
  const firstFill = cy.qty === 0; // posisi pertama siklus (termasuk siklus yang nunggu modal cukup lewat top up) -> pesan Buka Posisi
  const order = await ex.placeMarketEntry({ symbol: sym, direction: 'buy', notionalUsd: qty * px * 1.0000001, livePrice: px });
  const fillPx = parseFloat(order.avgPrice) || px, fillQty = parseFloat(order.executedQty) || qty;
  cy.qty += fillQty; cy.cost += fillQty * fillPx; cy.feeOpen += fillQty * fillPx * TAKER; cy.planted += deficit * (fillQty * fillPx) / addVol;
  cy.layers += 1; cy.filledLvl = levelHit; cy.lastDd = dd;
  j.cycle = cy; deps.save();
  log(`${opening ? 'BUKA' : topUp ? 'TOP UP' : 'TAMBAH'} siklus ${cy.signalId}: ${fillQty} BTC @ ${fillPx} (dd ${dd.toFixed(1)}%, level ${levelHit}) -- ditanam ${fmt$(cy.planted)} / modal ${fmt$(cy.cycleCap)}`);
  await deps.notify(firstFill ? openMsg(cy, dd, fillPx, deps) : addMsg(cy, dd, fillPx, fillQty, deps, topUp));
  return { bought: { opening: firstFill, topUp: !!topUp, qty: fillQty, px: fillPx, lvl: levelHit } };
}

// ================= MODE LADDER (11 Okt 2026) -- grid tangga ISOLATED, versi otomatis grid manual Olan =================
// Olan: bet = bet% x saldo TERBARU, mulai begitu BTC <= ATH -15%, tambah tiap harga turun gap% dari entry terakhir, untung minimal
// = 20% dari TOTAL yang udah di-bet (rugi bet yang kelikuidasi ikut ketutup dulu). Kasus terburuk: all-in, ambil 20% semuanya.
// Masalah: BingX 1 simbol = 1 posisi (bet gak bisa independen). Riset backtest/gridLotModeStudy.js (94 titik mulai 2018-25):
//   MERGE = tiap rebuy TUTUP posisi lama, BUKA lagi pakai sisa margin + bet baru (leverage tetap) -> x2,40 / terburuk x0,98
//   LOT VIRTUAL (1 posisi, tiap bet dipotong software di harga liq-nya)                         -> x2,31 / terburuk x0,94
// MERGE menang + selalu cuma 1 posisi ISOLATED, likuidasi diurus exchange sendiri (gak gantung VPS hidup). Parameter dari sweep
// (syarat Olan tahan crash -90%): bet 8%, jarak 20%, 5x -> x2,22, DD 60%, rungkad 0/94, peluru habis baru di ATH -93%.
async function runLadder(deps, log, now) {
  const { cfg, journal: j } = deps;
  const sym = cfg.symbol, ex = deps.exec, L = cfg.leverage, betPct = cfg.betPct || 8, gap = cfg.gapPct || 20, tpPct = cfg.ladderTpPct || 20;
  const px = await deps.price();
  const high = await deps.athCandidate().catch(() => null);
  if (!(px > 0)) { log('harga gak kebaca -- skip'); return { skipped: 'no-price' }; }
  const cand = Math.max(high || 0, px);
  if (!(j.ath > 0) || cand > j.ath) { j.ath = cand; j.athAt = now; }
  const dd = (1 - px / j.ath) * 100;
  let c = j.cycle;
  if (c && c.mode !== 'LADDER') { log('siklus lama bukan LADDER -- STOP, cek manual'); await deps.alert('⚠️ 🌾 Farmer: jurnal masih nyimpen siklus mode lama, ladder gak jalan. Cek manual.', 'mode'); return { stopped: 'mode' }; }

  // ---- rekonsiliasi ----
  const pos = await ex.getPositionBySide(sym, 'LONG');
  const exQty = pos ? Math.abs(parseFloat(pos.positionAmt)) : 0;
  const jQty = c && c.pos ? c.pos.qty : 0;
  if (jQty === 0 && exQty > 0) {
    const msg = `posisi LONG ${sym} ${exQty} ada di exchange tapi jurnal grid kosong -- grid BERHENTI, gak nyentuh posisi itu. Cek manual.`;
    log(msg); await deps.alert(`⚠️ 🌾 Farmer: ${msg}`, 'stray'); deps.save(); return { stopped: 'stray' };
  }
  if (jQty > 0 && exQty > 0 && Math.abs(exQty - jQty) / jQty > 0.02) {
    const msg = `qty exchange ${exQty} beda dari jurnal ${jQty.toFixed(4)} -- grid STOP sementara (gak nebak). Cek manual.`;
    log(msg); await deps.alert(`⚠️ 🌾 Farmer: ${msg}`, 'mismatch'); deps.save(); return { stopped: 'mismatch' };
  }
  // posisi hilang = kena likuidasi exchange (isolated) -> margin bet itu hangus, siklus lanjut (nunggu tangga berikutnya)
  if (jQty > 0 && exQty === 0) {
    const p = c.pos;
    // harga masih jauh di atas harga liq -> bukan likuidasi (kemungkinan ditutup manual) -> PnL ditaksir di harga sekarang + lapor
    if (px > p.liq * 1.03) {
      const est = p.qty * (px - p.e) - p.qty * px * TAKER; c.realized += est; c.fees += p.qty * px * TAKER; c.pos = null; deps.save();
      log(`posisi ${c.signalId} hilang padahal harga ${fmt$(px)} jauh di atas liq ${fmt$(p.liq)} -- dianggap ditutup manual (taksiran ${fmt$(est)})`);
      // ditutup di luar sistem -> siklus diakhiri (bukan dilanjut), biar tangga gak langsung buka lagi nimpa keputusan manual itu
      const rec = { id: c.id, signalId: c.signalId, mode: 'LADDER', openedAt: c.startedAt, entry: c.firstE, exit: px, qty: p.qty, planted: c.putIn, layers: c.bets, cycleCap: c.cycleCap, athAtStart: c.athAtStart, liqs: c.liqs || 0, closedAt: now, grossUsd: c.realized + c.fees, feeUsd: c.fees, net: c.realized, retPlantedPct: c.realized / c.putIn * 100, reason: 'GRID_GONE' };
      j.history.push(rec); j.cycle = null; j.manualPauseAt = now; deps.save();
      await deps.alert(`⚠️ 🌾 Farmer: posisi ${c.signalId} hilang dari BingX padahal belum nyentuh harga liq (${fmt$(p.liq)}). Ditutup manual? PnL ditaksir ${fmt$(est)} di harga ${fmt$(px)}. Siklus diakhiri; siklus baru mulai lagi dalam 24 jam kalau syarat terpenuhi (matiin di grid-config.json kalau mau berhenti).`, 'manualclose');
      return { manual: rec };
    } else {
      c.realized -= p.mg; c.liqs = (c.liqs || 0) + 1; c.pos = null;
      log(`posisi ${c.signalId} kena likuidasi (entry ${fmt$(p.e)}, margin ${fmt$(p.mg)} hangus) -- total rugi terealisasi ${fmt$(-c.realized)}`);
      await deps.notify(ladderLiqMsg(c, p, px, deps));
      deps.save();
    }
  }

  // ---- TP: rugi terealisasi + floating bersih >= tpPct% x total bet ----
  if (c && c.pos) {
    const p = c.pos, net = c.realized + p.qty * (px - p.e) - p.qty * px * TAKER;
    if (net >= c.putIn * tpPct / 100) {
      const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'buy', quantity: p.qty });
      const order = o && o.order ? o.order : o;
      const exit = parseFloat(order && order.avgPrice) || px;
      const fee = p.qty * exit * TAKER, n2 = c.realized + p.qty * (exit - p.e) - fee;
      const rec = { id: c.id, signalId: c.signalId, mode: 'LADDER', openedAt: c.startedAt, entry: c.firstE, exit, qty: p.qty, planted: c.putIn, layers: c.bets, cycleCap: c.cycleCap, athAtStart: c.athAtStart, liqs: c.liqs || 0,
        closedAt: now, grossUsd: n2 + c.fees + fee, feeUsd: c.fees + fee, net: n2, retPlantedPct: n2 / c.putIn * 100, reason: 'GRID_LADDER_TP' };
      j.history.push(rec); if (j.history.length > 500) j.history = j.history.slice(-500);
      j.stats.cycles += 1; j.stats.totalPnlUsd += n2; if (n2 >= 0) j.stats.wins += 1; else j.stats.losses += 1;
      j.cycle = null; j.lastWallet = await ex.getWalletBalance(cfg.marginAsset).catch(() => j.lastWallet); deps.save();
      log(`TP ladder ${rec.signalId}: ${c.bets} tangga, total modal masuk ${fmt$(c.putIn)} -> net ${fmt$(n2)} (+${rec.retPlantedPct.toFixed(1)}% dari total modal masuk)`);
      await deps.notify(closeMsg(rec, j, deps));
      return { tp: rec };
    }
  }

  // ---- SALDO TERBARU + BATAS MODAL (11 Okt 2026, Olan: "bet selalu pake saldo terbaru.. saldo aku tambah2, aku lepas kalo dah
  // 1000 dolar, jadi modal yang masuk bisa buat strategi lain") ----
  // Acuan modal tangga = saldo wallet USDC terbaru, dipotong di maxCapUsd. Top up / tarik di tengah siklus kebaca (saldo beda dari
  // perkiraan jurnal > max($5, 2%)) -> modal per tangga langsung ikut. Rugi tangga siklus ini sendiri GAK ngecilin acuan (sama
  // kayak backtest). Saldo lewat batas -> Olan dikabarin (maks 1x/7 hari) biar lebihnya dipindah ke Sniper/Ranger -- Kaela GAK
  // mindahin dana sendiri.
  // Dompet Farmer dari web (Kaela Access, owner) nimpa bankReserveUsd + selfCustodyWallets di config -- REAL doang, cache 10 menit.
  if (!deps.isDemo && deps.fetchFarmerFunds && (!j.webFunds || now - j.webFunds.at > 10 * 60e3)) {
    try { const ff = await deps.fetchFarmerFunds(); if (ff && ff.updatedAt) j.webFunds = { at: now, ...ff }; else if (j.webFunds) j.webFunds.at = now; }
    catch (e) { log(`baca Dompet Farmer dari web gagal (pakai yang terakhir/config): ${e.message}`); }
  }
  if (j.webFunds && j.webFunds.updatedAt) { cfg.bankReserveUsd = j.webFunds.bankUsd || 0; cfg.selfCustodyWallets = j.webFunds.wallets || []; }
  const maxCap = cfg.maxCapUsd || 0;
  const capOf = (w) => (maxCap > 0 ? Math.min(w, maxCap) : w);
  // CADANGAN BANK (11 Okt 2026, Olan: "saldo di BingX buat mewakili seluruh saldo.. aku mau meresikokan uang yang ada di bank..
  // USDC sekarang cuma 94 dolar, itu 10% uangku aja"). Modal acuan = saldo BingX + cadangan bank (bankReserveUsd di config).
  // Top up dari bank kebaca -> cadangan otomatis berkurang segitu (total gak dobel). Ganti angka di config = cadangan di-set ulang.
  // Tangga yang marginnya belum ada di BingX -> GAK dibuka kecil diem2: Olan dikabarin top up berapa (DM, maks 1x/6 jam).
  if (j.reserveCfg !== (cfg.bankReserveUsd || 0)) { j.reserveCfg = cfg.bankReserveUsd || 0; j.bankReserve = j.reserveCfg; }
  // DOMPET PRIBADI (11 Okt 2026, Olan: "baca dompet kripto misal Trust Wallet.. BingX bisa rungkad kayak MtGox/FTX, mending nganggur
  // tapi aman di dompet sendiri") -- stablecoin di alamat publik cfg.selfCustodyWallets (selfCustodyWallet.js) ikut jadi modal acuan.
  // Dibaca tiap 10 menit; gagal baca -> pakai angka terakhir (maks 6 jam), lewat itu gak dihitung + Olan dikabarin.
  const wallets = cfg.selfCustodyWallets || [];
  const refreshCustody = async (force) => {
    if (!wallets.length) { j.custody = null; return; }
    if (!force && j.custody && now - j.custody.at < 10 * 60e3) return;
    try { const r = await (deps.readCustody || require('./selfCustodyWallet').readTotalStable)(wallets); j.custody = { at: now, total: r.total, detail: r.detail }; }
    catch (e) {
      log(`baca dompet pribadi gagal: ${e.message}`);
      if (!j.custody || now - j.custody.at > 6 * 3600e3) await deps.alert(`⚠️ 🌾 Farmer: saldo dompet pribadi gak kebaca > 6 jam (${e.message}). Sementara modal acuan cuma BingX + cadangan bank.`, 'custody');
    }
  };
  const custodyTotal = () => (j.custody && now - j.custody.at <= 6 * 3600e3 ? j.custody.total : 0);
  await refreshCustody(false);
  const reserve = () => Math.max(0, j.bankReserve || 0) + custodyTotal();
  const useDeposit = async (d) => {
    if (!(d > 0)) return;
    const before = custodyTotal(); await refreshCustody(true); const drop = before - custodyTotal();
    if (drop >= d * 0.8) { log(`top up ${fmt$(d)} dari dompet pribadi (dompet turun ${fmt$(drop)})`); return; }
    if ((j.bankReserve || 0) > 0) { const used = Math.min(d, j.bankReserve); j.bankReserve -= used; log(`top up ${fmt$(d)} dianggap dari bank -> cadangan bank sisa ${fmt$(j.bankReserve)}`); }
  };
  const overCap = async (w) => {
    if (cfg.overCapAlert === false || !(maxCap > 0 && w > maxCap * 1.05) || (j.overCapAt && now - j.overCapAt < 7 * 864e5)) return;
    j.overCapAt = now; deps.save();
    await deps.alert(`💰 🌾 Farmer: saldo USDC BingX udah ${fmt$(w)}, lewat batas modal grid ${fmt$(maxCap)}. Grid tetap jalan pakai ${fmt$(maxCap)}; lebihnya ${fmt$(w - maxCap)} bisa kamu pindahin ke Sniper / Ranger / Ranger Rotasi.`, 'overcap');
  };
  if (c) {
    const w = await ex.getWalletBalance(cfg.marginAsset).catch(() => null);
    if (w > 0) {
      if (c.anchor == null) c.anchor = c.cycleCap - c.realized; // jurnal sebelum fitur ini
      const expected = c.anchor + c.realized, d = w - expected;
      c.anchor += d; // selisih kecil (funding dll) diserap, selisih besar = top up / tarik
      if (d > Math.max(5, Math.abs(expected) * 0.02)) await useDeposit(d);
      j.lastWallet = w;
      const from = c.cycleCap, to = capOf(c.anchor + reserve());
      if (Math.abs(d) > Math.max(5, Math.abs(expected) * 0.02) || Math.abs(to - from) > Math.max(5, from * 0.02)) {
        if (Math.abs(to - from) > 0.01) {
          c.cycleCap = to; c.unit = to * betPct / 100; (c.capChanges = c.capChanges || []).push({ at: now, from, to, wallet: w });
          log(`${Math.abs(d) > 5 ? (d > 0 ? 'top up' : 'tarik') + ' kebaca (' + fmt$(d) + ')' : 'batas modal di config berubah'} -> acuan modal tangga ${fmt$(from)} -> ${fmt$(to)}, modal per tangga ${fmt$(c.unit)}`);
        }
      }
      deps.save();
      await overCap(w);
    }
  }

  // ---- entry / rebuy ----
  if (!c) {
    if (dd < cfg.minDd) { deps.save(); return { idle: `dd ${dd.toFixed(1)}% < ${cfg.minDd}%` }; }
    if (j.manualPauseAt && now - j.manualPauseAt < 24 * 3600e3) { deps.save(); return { idle: 'jeda 24 jam abis tutup manual' }; }
    const walletAll = await ex.getWalletBalance(cfg.marginAsset);
    if (j.lastWallet > 0 && walletAll - j.lastWallet > Math.max(5, j.lastWallet * 0.02)) await useDeposit(walletAll - j.lastWallet); // top up di antara siklus
    j.lastWallet = walletAll;
    await overCap(walletAll);
    const wallet = capOf(walletAll + reserve());
    const unit = wallet * betPct / 100;
    const info = await ex.getSymbolInfo(sym);
    if (!(unit * L >= Math.max(info.minNotionalUsd || 0, px * info.stepSize) * 1.05)) {
      if (!j.noBalLogAt || now - j.noBalLogAt > 6 * 3600e3) { log(`saldo ${cfg.marginAsset} ${wallet} -- modal per tangga ${betPct}% kekecilan buat minimum order (syarat entry udah terpenuhi: ATH -${dd.toFixed(1)}%)`); j.noBalLogAt = now; }
      deps.save(); return { idle: 'no-balance' };
    }
    if (!j.seq || j.seq.day !== new Date(now).toISOString().slice(0, 10)) j.seq = { day: new Date(now).toISOString().slice(0, 10), n: 0 };
    j.seq.n += 1;
    c = { mode: 'LADDER', id: `grid-${now}`, signalId: `G${j.seq.day.replace(/-/g, '')}${String(j.seq.n).padStart(2, '0')}`, startedAt: now, athAtStart: j.ath, cycleCap: wallet, anchor: walletAll, unit, putIn: 0, realized: 0, fees: 0, bets: 0, liqs: 0, pos: null, lastE: null, firstE: null };
    await ex.setIsolatedMargin(sym).catch((e) => log(`set isolated: ${e.message}`));
    await ex.setLeverage(sym, L, 'LONG').catch((e) => log(`set leverage: ${e.message}`));
  } else if (c.pos && !(px <= c.lastE * (1 - gap / 100))) { deps.save(); return { idle: 'nunggu tangga' }; }
  // posisi terakhir udah kelikuidasi (c.pos kosong) -> tangga berikutnya LANGSUNG dibuka di harga sekarang. Dulu nunggu -gap% dari
  // entry terakhir: kalau harga mantul di antara harga liq (-19,5%) & -20%, siklus MACET selamanya tanpa posisi (backtest seumur
  // hidup: macet 2020-09 .. 2026, ketemu 11 Okt 2026).

  if (c.putIn + c.unit > c.cycleCap * 1.0001) {
    if (!c.pos) { // peluru habis + semua kelikuidasi = rungkad -> catat, siklus baru mulai dari saldo sisa
      const rec = { id: c.id, signalId: c.signalId, mode: 'LADDER', openedAt: c.startedAt, entry: c.firstE, exit: null, qty: 0, planted: c.putIn, layers: c.bets, cycleCap: c.cycleCap, athAtStart: c.athAtStart, liqs: c.liqs, closedAt: now, grossUsd: c.realized + c.fees, feeUsd: c.fees, net: c.realized, retPlantedPct: c.realized / c.putIn * 100, reason: 'GRID_LADDER_RUNGKAD' };
      j.history.push(rec); j.stats.cycles += 1; j.stats.losses += 1; j.stats.totalPnlUsd += c.realized; j.cycle = null; deps.save();
      await deps.alert(`⚠️ 🌾 Farmer ${c.signalId} RUNGKAD: semua ${c.bets} tangga kelikuidasi (${fmt$(c.putIn)}). Siklus baru mulai dari saldo sisa.`, 'rungkad');
      return { rungkad: rec };
    }
    deps.save(); return { idle: 'peluru habis, nunggu mantul' };
  }
  // margin tangga baru harus udah ada di BingX (saldo bebas = saldo - margin posisi lama) -- kalau kurang: kabarin top up, tunggu
  {
    const wNow = await ex.getWalletBalance(cfg.marginAsset).catch(() => null);
    const free = wNow != null ? wNow - (c.pos ? c.pos.mg : 0) : null;
    if (free != null && free < c.unit * 0.99) {
      const need = c.unit - free;
      log(`tangga #${c.bets + 1} butuh margin ${fmt$(c.unit)}, saldo bebas BingX cuma ${fmt$(free)} -- nunggu top up ${fmt$(need)}`);
      await deps.alert(`🌾 Farmer: waktunya tangga #${c.bets + 1} (BTC ${fmt$(px)}), tapi saldo BingX kurang. Top up minimal ${fmt$(Math.ceil(need))} ${cfg.marginAsset} dari bank ya -- begitu masuk, tangga langsung kebuka (selama harga masih di zona tangga). Cadangan tercatat: bank ${fmt$(j.bankReserve || 0)}${wallets.length ? ` + dompet pribadi ${fmt$(custodyTotal())}` : ''}.`, 'topup');
      if (!c.pos) c.waitTopUpSince = c.waitTopUpSince || now;
      deps.save(); return { idle: 'nunggu top up', need };
    }
    c.waitTopUpSince = null;
  }
  // MERGE: tutup posisi lama dulu, sisa margin + bet baru dibuka lagi jadi 1 posisi isolated (leverage tetap)
  let carry = 0, closedOld = null;
  if (c.pos) {
    const p = c.pos;
    const o = await ex.emergencyCloseMarket({ symbol: sym, direction: 'buy', quantity: p.qty });
    const order = o && o.order ? o.order : o;
    const exit = parseFloat(order && order.avgPrice) || px;
    const pnl = p.qty * (exit - p.e), fee = p.qty * exit * TAKER;
    c.realized += pnl - fee; c.fees += fee; carry = Math.max(0, p.mg + pnl - fee); closedOld = { e: p.e, exit, pnl };
    c.pos = null; deps.save();
  }
  const wallet = await ex.getWalletBalance(cfg.marginAsset).catch(() => null);
  const mg = Math.min(carry + c.unit, wallet > 0 ? wallet * 0.98 : carry + c.unit);
  const info = await ex.getSymbolInfo(sym);
  const qty = ex.roundToStepSize ? ex.roundToStepSize(mg * L / px, info.stepSize, info.quantityPrecision) : Math.floor(mg * L / px / info.stepSize) * info.stepSize;
  const order = await ex.placeMarketEntry({ symbol: sym, direction: 'buy', notionalUsd: qty * px * 1.0000001, livePrice: px });
  const fillPx = parseFloat(order.avgPrice) || px, fillQty = parseFloat(order.executedQty) || qty;
  const feeIn = fillQty * fillPx * TAKER;
  c.pos = { e: fillPx, qty: fillQty, mg: fillQty * fillPx / L, liq: fillPx * (1 - 1 / L + 0.005) };
  const exPos = await ex.getPositionBySide(sym, 'LONG').catch(() => null);
  const exLiq = exPos ? parseFloat(exPos.liquidationPrice) : NaN, exMg = exPos ? parseFloat(exPos.initialMargin || exPos.margin) : NaN;
  if (exLiq > 0 && exLiq < fillPx) c.pos.liq = exLiq;
  if (exMg > 0) c.pos.mg = exMg;
  c.realized -= feeIn; c.fees += feeIn; c.putIn += c.unit; c.bets += 1; c.lastE = fillPx; if (!c.firstE) c.firstE = fillPx;
  j.cycle = c; deps.save();
  const tpPx = c.pos.e + (c.putIn * tpPct / 100 - c.realized) / (c.pos.qty * (1 - TAKER));
  log(`${c.bets === 1 ? 'BUKA' : 'TAMBAH'} ladder ${c.signalId} tangga #${c.bets}: ${fillQty} BTC @ ${fillPx} margin ${fmt$(c.pos.mg)} (${L}x isolated, liq ~${fmt$(c.pos.liq)}) -- total modal masuk ${fmt$(c.putIn)}, target ${fmt$(tpPx)}`);
  await deps.notify(c.bets === 1 ? ladderOpenMsg(c, dd, tpPx, deps) : ladderAddMsg(c, dd, tpPx, closedOld, deps));
  return { bought: { opening: c.bets === 1, bet: c.bets, qty: fillQty, px: fillPx, mg: c.pos.mg, tpPx } };
}
function ladderLiqMsg(c, p, px, deps) {
  const { formatAutoClosed, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  const alasan = `tangga #${c.bets} kena likuidasi (cuma margin tangga ini). Siklus lanjut: tangga berikutnya langsung dibuka, targetnya nutup rugi ini.`;
  return formatAutoClosed({ id: c.id, signalId: c.signalId, direction: 'long', entryPrice: p.e, exitPrice: px, pnlUsd: -p.mg, pnlPct: -100, assetLabel: assetOf(deps) }, new Date(), !!deps.isDemo, alasan, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
const assetOf = (deps) => String(deps.cfg.symbol || 'BTC-USDC').replace('-', '');
function ladderReason(c, dd, deps) {
  const gap = deps.cfg.gapPct || 15;
  return `BTC di ATH -${dd.toFixed(0)}%. Tangga #${c.bets} (${deps.cfg.betPct || 6}% saldo). Tangga berikutnya di ${fmt$(c.lastE * (1 - gap / 100))}.`;
}
function ladderTpText(c, tpPx, deps) {
  return `${fmt$(tpPx)} (+${deps.cfg.ladderTpPct || 30}% total modal ${fmt$(c.putIn)}${c.realized + c.fees < -0.01 ? ', udah nutup rugi tangga sebelumnya' : ''})`;
}
function ladderOpenMsg(c, dd, tpPx, deps) {
  const { formatAutoOpen, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoOpen({
    id: c.id, signalId: c.signalId, direction: 'buy', entryPrice: c.pos.e, marginUsd: c.pos.mg, leverage: deps.cfg.leverage, nilaiPosisi: c.pos.qty * c.pos.e,
    tpText: ladderTpText(c, tpPx, deps), slText: 'tanpa SL (isolated)', liquidationNote: fmt$(c.pos.liq),
    assetLabel: assetOf(deps), reasonText: ladderReason(c, dd, deps),
  }, new Date(), '', !!deps.isDemo, null, '', null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
function ladderAddMsg(c, dd, tpPx, closedOld, deps) {
  const { formatAutoAddLayer, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoAddLayer({
    id: c.id, signalId: c.signalId, layers: c.bets, entryPrice: c.pos.e, marginUsd: c.pos.mg, leverage: deps.cfg.leverage, nilaiPosisi: c.pos.qty * c.pos.e, assetLabel: assetOf(deps),
    reasonText: `${ladderReason(c, dd, deps)} Target ${ladderTpText(c, tpPx, deps)}. Likuidasi ${fmt$(c.pos.liq)}.${closedOld ? ' Sisa margin tangga lama digabung.' : ''}`,
  }, new Date(), !!deps.isDemo, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}

function summary(c) { return { id: c.id, signalId: c.signalId, openedAt: c.startedAt, entry: c.qty > 0 ? c.cost / c.qty : null, qty: c.qty, planted: c.planted, layers: c.layers, cycleCap: c.cycleCap, athAtStart: c.athAtStart }; }

function openMsg(cy, dd, fillPx, deps) {
  const { formatAutoOpen, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoOpen({
    id: cy.id, signalId: cy.signalId, direction: 'buy', entryPrice: fillPx, marginUsd: cy.planted, leverage: Math.max(1, Math.round(cy.cost / Math.max(cy.planted, 1e-9) * 10) / 10), nilaiPosisi: cy.cost,
    tpText: `+${deps.cfg.tp}% dari modal yang ditanam (tutup semua, siklus diulang dari acuan ATH)`,
    slText: 'tanpa SL -- grid nambah tiap BTC turun 1%, eksposur dijaga maks ' + deps.cfg.capExposure + 'x modal grid',
    liquidationNote: 'cross margin -- jauh (eksposur rendah)', assetLabel: String(deps.cfg.symbol || 'BTC-USDC').replace('-', ''),
    reasonText: `Grid ATH: BTC di ATH -${dd.toFixed(1)}% (ATH ${fmt$(cy.athAtStart)}, syarat <= -${deps.cfg.minDd}% terpenuhi) -- tanam ${(cy.planted / cy.cycleCap * 100).toFixed(0)}% modal grid (${fmt$(cy.planted)} dari ${fmt$(cy.cycleCap)})`,
  }, new Date(), '', !!deps.isDemo, null, '', null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
function addMsg(cy, dd, fillPx, fillQty, deps, topUp) {
  const { formatAutoAddLayer, EXCHANGE_BADGE, SYSTEM_LABEL } = require('./darkKaelaLog');
  return formatAutoAddLayer({
    id: cy.id, signalId: cy.signalId, layers: cy.layers, entryPrice: cy.cost / cy.qty, marginUsd: cy.planted, leverage: Math.max(1, Math.round(cy.cost / Math.max(cy.planted, 1e-9) * 10) / 10), nilaiPosisi: cy.cost, assetLabel: String(deps.cfg.symbol || 'BTC-USDC').replace('-', ''),
    reasonText: topUp
      ? `Top up modal grid kebaca ${fmt$(topUp.from)} -> ${fmt$(topUp.to)} -- porsi dikejar seolah modal udah ada dari awal: beli ${fillQty} BTC @ ${fmt$(fillPx)} (ditanam ${(cy.planted / cy.cycleCap * 100).toFixed(0)}% modal, BTC di ATH -${dd.toFixed(1)}%)`
      : `BTC turun ke ATH -${dd.toFixed(1)}% -> rebuy ${fillQty} BTC @ ${fmt$(fillPx)} (total ditanam ${(cy.planted / cy.cycleCap * 100).toFixed(0)}% modal grid)`,
  }, new Date(), !!deps.isDemo, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
}
function closeMsg(rec, j, deps) {
  const { formatAutoClosed, formatWinRateLines, CLOSE_REASON_LABEL, EXCHANGE_BADGE, SYSTEM_LABEL, KAELA_ACCESS_URL } = require('./darkKaelaLog');
  const base = formatAutoClosed({ id: rec.id, signalId: rec.signalId, direction: 'long', entryPrice: rec.entry, exitPrice: rec.exit, pnlUsd: rec.grossUsd, feeUsd: rec.feeUsd, pnlPct: rec.retPlantedPct, assetLabel: String(deps.cfg.symbol || 'BTC-USDC').replace('-', '') }, new Date(), false, `${CLOSE_REASON_LABEL[rec.reason] || CLOSE_REASON_LABEL.GRID_TP} (${rec.layers} ${rec.mode === 'LADDER' ? 'tangga' : 'layer'})`, null, null, EXCHANGE_BADGE.bingx, SYSTEM_LABEL.GRID);
  return base.replace(`🔗 ${KAELA_ACCESS_URL}`, formatWinRateLines(j.stats, rec.mode === 'LADDER' ? `Farmer (${deps.isDemo ? 'Demo' : 'Real'})` : 'Grid ATH (Real)', null) + `🔗 ${KAELA_ACCESS_URL}`);
}

// ================= Wiring produksi =================
function prodDeps(cfg, journal) {
  const { createBingxClient, loadSecrets } = require('./bingxExecutor');
  const s = loadSecrets();
  const exec = s.BINGX_API_KEY && s.BINGX_API_SECRET ? createBingxClient({ apiKey: s.BINGX_API_KEY, apiSecret: s.BINGX_API_SECRET, testnet: DEMO }) : null;
  const alerts = journal.alerts || (journal.alerts = {});
  return {
    cfg, journal, exec, isDemo: DEMO,
    fetchFarmerFunds: DEMO ? null : () => require('./kaelaProTraderClient').getFarmerFunds(),
    price: async () => {
      const r = await (await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${cfg.symbol}`, { signal: AbortSignal.timeout(8000) })).json();
      return parseFloat(r && r.data && r.data.price);
    },
    // ATH: high 1 jam terbaru Binance BTCUSDT (+ inisialisasi sekali dari seluruh riwayat harian kalau jurnal belum punya)
    athCandidate: async () => {
      if (!(journal.ath > 0)) {
        let best = 0, cur = Date.UTC(2017, 7, 17);
        while (cur < Date.now()) {
          const k = await (await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${cur}&limit=1000`, { signal: AbortSignal.timeout(15000) })).json();
          if (!Array.isArray(k) || !k.length) break;
          for (const x of k) best = Math.max(best, +x[2]);
          cur = k[k.length - 1][0] + 864e5; if (k.length < 1000) break;
        }
        return best;
      }
      const k = await (await fetch('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3', { signal: AbortSignal.timeout(8000) })).json();
      return Math.max(...k.map((x) => +x[2]));
    },
    notify: async (msg) => {
      // 11 Okt 2026, Olan: "demo itu gpp boleh jalan di grup sniper" -> Farmer DEMO juga ke Sniper Club (link diganti web Sniper,
      // pola sama Ninja demo). Aturan lintas sistem: apa pun yang ke Sniper Club WAJIB juga ke Wibowo (tetap di bawah). Real = Wibowo doang.
      if (DEMO) { try { const { toSniperClubLink } = require('./darkKaelaLog'); await require('./fonnte').sendWhatsAppToSniperClub(toSniperClubLink(msg)); } catch (e) { console.log('[Grid] WA Sniper Club gagal:', e.message); } }
      try { await require('./wibowoNotify').sendWhatsAppToWibowo(msg); } catch (e) { console.log('[Grid] WA Wibowo gagal:', e.message); }
    },
    // peringatan (gak beres) -> DM Olan HP utama, maks 1x/6 jam per jenis (anti-spam)
    alert: async (msg, kind) => {
      const last = alerts[kind] || 0; if (Date.now() - last < 6 * 3600e3) return;
      alerts[kind] = Date.now();
      try { await require('./fonnte').sendWhatsApp(`${DEMO ? '(Demo) ' : ''}${msg}\n\n— Kaela`, OLAN_PRIBADI); } catch (e) { console.log('[Grid] WA alert gagal:', e.message); }
    },
    log: (m) => console.log(`[${new Date().toISOString()}] [Grid] ${m}`),
    save: () => saveJournal(journal),
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const j = loadJournal();
  const deps = prodDeps(cfg, j);
  try { await runOnce(deps); }
  catch (e) {
    deps.log(`GAGAL: ${e.message}`);
    await deps.alert(`⚠️ Grid GAGAL jalan: ${e.message}`, `err:${String(e.message).slice(0, 40)}`);
    saveJournal(j);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runOnce, loadConfig, freshJournal, multAt };
