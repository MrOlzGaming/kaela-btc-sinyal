// tools/bingxOrderApiCheck.js (30 Sep 2026) -- verifikasi EMPIRIS endpoint order LIMIT/STOP BingX yang
// dipakai ninjaMrTrader.js (placeLimitEntry post-only, placeStopMarketClose, placeLimitClose, getOrder,
// cancelOrder, getPositionBySide) -- ditulis dari dokumentasi, BELUM pernah dites di akun asli (sesi
// cloud diblokir ke open-api.bingx.com). Jalankan SEKALI dari VPS Vultr SEBELUM sinyal Ninja MR pertama:
//     node tools/bingxOrderApiCheck.js
//
// ⛔ DEMO (VST) SAJA -- testnet DIHARDCODE true, gak ada flag buat real. Uang palsu, nol risiko.
// Yang dilakukan (semua di BTC-USDT demo, semua dibersihin lagi di akhir walau ada yang gagal):
//   A. LIMIT BUY post-only 20% DI BAWAH harga (gak bakal fill) -> getOrder (status NEW) -> cancelOrder -> getOrder (CANCELED)
//   B. MARKET LONG mini (notional minimum x1.5) -> STOP_MARKET close 10% di bawah + LIMIT close 20% di atas
//      -> getOrder keduanya (NEW) -> cancel keduanya -> tutup posisi market -> getPositionBySide null
//   C. Cetak field yang dibaca eksekutor (status/executedQty/avgPrice/commission) apa adanya dari respons.
// Syarat: akun demo lagi KOSONG (gak ada posisi/order) -- kalau ada, script berhenti (jangan campur
// dengan posisi Ninja MR yang lagi jalan). Eksekutor Ninja MR bakal skip entry 1 siklus kalau kebetulan
// sinyal muncul pas script ini jalan (posisi tes ke-detect sbg "punya Kaela") -- wajar, sekali doang.

const { loadSecrets, createBingxClient } = require('../bingxExecutor');

const SYMBOL = 'BTC-USDT';
const results = [];
function ok(name, detail) { results.push({ ok: true, name, detail }); console.log(`  ✅ ${name}${detail ? ' -- ' + detail : ''}`); }
function fail(name, e) { results.push({ ok: false, name, detail: e && e.message ? e.message : String(e) }); console.log(`  ❌ ${name} -- ${e && e.message ? e.message : e}`); }
const show = (o) => JSON.stringify(o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => ['orderId', 'status', 'executedQty', 'avgPrice', 'commission', 'price', 'stopPrice', 'type', 'side', 'positionSide', 'timeInForce', 'clientOrderId'].includes(k))) : o);

async function main() {
  const secrets = loadSecrets();
  if (!secrets.BINGX_API_KEY || !secrets.BINGX_API_SECRET) { console.log('BINGX_API_KEY/SECRET kosong di secrets.js -- gak bisa tes.'); process.exit(2); }
  const ex = createBingxClient({ apiKey: secrets.BINGX_API_KEY, apiSecret: secrets.BINGX_API_SECRET, testnet: true }); // DEMO SAJA
  const live = parseFloat((await (await fetch(`https://open-api-vst.bingx.com/openApi/swap/v1/ticker/price?symbol=${SYMBOL}`)).json()).data.price);
  const info = await ex.getSymbolInfo(SYMBOL);
  const bal = await ex.getAccountBalance('VST');
  console.log(`DEMO VST -- harga ${live}, saldo ${bal} VST, stepSize ${info.stepSize}, minNotional $${info.minNotionalUsd}, pricePrecision ${info.pricePrecision}`);
  const positions = await ex.getAllPositions();
  if (positions.length) { console.log('⛔ Akun demo lagi ada posisi -- berhenti, jangan campur. Posisi:', positions.map((p) => `${p.positionSide} ${p.positionAmt}`).join(', ')); process.exit(3); }
  // (3 Okt 2026) FIX: minNotional BTC cuma $2 tapi qty minimal 1 step (0,0001 BTC ~$8,5) -- $3/harga kebulet jadi 0. Ambil yang
  // lebih gede: notional minimum x1,5 ATAU 1 step.
  const qty = Math.max(info.stepSize, ex.roundToStepSize(Math.max(2, (info.minNotionalUsd || 2) * 1.5) / live, info.stepSize, info.quantityPrecision));
  if (qty <= 0) { console.log('qty kehitung 0 -- stepSize/minNotional aneh:', info); process.exit(4); }
  console.log(`qty tes ${qty} BTC (~$${(qty * live).toFixed(2)})\n`);

  let limitId = null, stopId = null, exitId = null, opened = false;
  try {
    // ---------- A: LIMIT post-only jauh dari harga ----------
    console.log('A. LIMIT post-only (BUY 20% di bawah harga):');
    try {
      const o = await ex.placeLimitEntry({ symbol: SYMBOL, direction: 'buy', quantity: qty, price: live * 0.8, postOnly: true });
      limitId = o.orderId; ok('placeLimitEntry', show(o));
    } catch (e) { fail('placeLimitEntry', e); }
    if (limitId) {
      try { const o = await ex.getOrder(SYMBOL, limitId); if (!o) throw new Error('order null'); (String(o.status).toUpperCase() === 'NEW' || String(o.status).toUpperCase() === 'PENDING' ? ok : fail)('getOrder (limit ngendap)', show(o)); } catch (e) { fail('getOrder (limit)', e); }
      try { await ex.cancelOrder(SYMBOL, limitId); ok('cancelOrder (limit)'); } catch (e) { fail('cancelOrder (limit)', e); }
      try { const o = await ex.getOrder(SYMBOL, limitId); const st = o ? String(o.status).toUpperCase() : 'null'; (['CANCELED', 'CANCELLED'].includes(st) ? ok : fail)('getOrder setelah cancel', `status ${st}`); } catch (e) { fail('getOrder setelah cancel', e); }
      limitId = null;
    }

    // ---------- B: posisi mini + STOP_MARKET + LIMIT close ----------
    console.log('\nB. MARKET LONG mini + STOP_MARKET + LIMIT close:');
    try {
      await ex.setIsolatedMargin(SYMBOL).catch(() => {});
      await ex.setLeverage(SYMBOL, 5, 'LONG');
      const o = await ex.placeMarketEntry({ symbol: SYMBOL, direction: 'buy', notionalUsd: qty * live, livePrice: live });
      opened = true; ok('placeMarketEntry (demo)', show(o));
      console.log('     field fee di order market:', o.commission === undefined ? 'commission TIDAK ADA di respons (fallback bakal dipakai)' : `commission=${o.commission}`);
    } catch (e) { fail('placeMarketEntry', e); }
    if (opened) {
      let pos = null;
      try { pos = await ex.getPositionBySide(SYMBOL, 'LONG'); (pos ? ok : fail)('getPositionBySide LONG', pos ? `amt ${pos.positionAmt} avg ${pos.avgPrice}` : 'null'); } catch (e) { fail('getPositionBySide', e); }
      const amt = pos ? Math.abs(parseFloat(pos.positionAmt)) : qty;
      try { const o = await ex.placeStopMarketClose({ symbol: SYMBOL, direction: 'buy', quantity: amt, stopPrice: live * 0.9 }); stopId = o.orderId; ok('placeStopMarketClose', show(o)); } catch (e) { fail('placeStopMarketClose', e); }
      try { const o = await ex.placeLimitClose({ symbol: SYMBOL, direction: 'buy', quantity: amt, price: live * 1.2 }); exitId = o.orderId; ok('placeLimitClose', show(o)); } catch (e) { fail('placeLimitClose', e); }
      for (const [id, nm] of [[stopId, 'stop'], [exitId, 'limit close']]) {
        if (!id) continue;
        try { const o = await ex.getOrder(SYMBOL, id); (o && ['NEW', 'PENDING'].includes(String(o.status).toUpperCase()) ? ok : fail)(`getOrder (${nm} ngendap)`, show(o)); } catch (e) { fail(`getOrder (${nm})`, e); }
      }
    }
  } finally {
    console.log('\nBersih-bersih:');
    for (const [id, nm] of [[limitId, 'limit'], [stopId, 'stop'], [exitId, 'limit close']]) {
      if (!id) continue;
      try { await ex.cancelOrder(SYMBOL, id); ok(`cancel ${nm}`); } catch (e) { fail(`cancel ${nm}`, e); }
    }
    try { await ex.cancelAllOpenOrders(SYMBOL); } catch { /* boleh gagal kalau emang kosong */ }
    if (opened) {
      try {
        const pos = await ex.getPositionBySide(SYMBOL, 'LONG');
        if (pos) { const r = await ex.emergencyCloseMarket({ symbol: SYMBOL, direction: 'buy', quantity: Math.abs(parseFloat(pos.positionAmt)) }); ok('emergencyCloseMarket', show(r && r.order ? r.order : r)); }
        const after = await ex.getPositionBySide(SYMBOL, 'LONG');
        (after === null ? ok : fail)('posisi bersih setelah tutup', after ? `masih ada ${after.positionAmt}` : '');
      } catch (e) { fail('tutup posisi tes', e); }
    }
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK.` + (bad.length ? ` GAGAL: ${bad.map((b) => b.name).join(', ')} -- JANGAN nyalain Ninja MR real sebelum ini beres; kirim output ini ke Kaela.` : ' Semua endpoint yang dipakai ninjaMrTrader.js terbukti jalan di demo.'));
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
