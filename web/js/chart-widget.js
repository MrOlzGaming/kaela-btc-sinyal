// Widget harga live + grafik candlestick/area multi-timeframe + indikator + toolbar gambar
// analisa multi-alat (ala TradingView/BC.Game): Kursor, Garis Tren, Garis Horizontal,
// Fibonacci Retracement, Teks. Pakai TradingView Lightweight Charts (self-hosted,
// lightweight-charts.standalone.production.js) -- library resmi open-source (Apache 2.0)
// dari TradingView sendiri, jadi pan/zoom/crosshair beneran ala TradingView, bukan tiruan
// manual. Tetap zero-dependency runtime: file library-nya di-download sekali dan disimpan
// statis di repo. Attribution logo bawaan dimatikan (attributionLogo:false) karena sudah ada
// link atribusi eksplisit sendiri di bawah chart -- logo bawaan kepotong/kekecilan di tinggi
// chart 320px kita.
// Live movement dari Binance WebSocket. "All Time" pakai data historis 2014+ statis
// (data/btc-history.json).
// Semua gambar TERSIMPAN di localStorage per timeframe, koordinat DATA-SPACE (waktu asli +
// harga asli) -- Garis Horizontal & Fibonacci pakai native price line API (otomatis ikut
// price-scale), Garis Tren pakai overlay canvas custom (dihitung ulang tiap frame dari
// waktu/harga -> pixel), Teks pakai native series markers (snap ke candle terdekat).

(function () {
  const PRICE_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  const KLINES_URL = 'https://api.binance.com/api/v3/klines';
  const WS_BASE = 'wss://stream.binance.com:9443/ws/btcusdt@kline_';
  const SHAPES_STORAGE_KEY = 'kaela_chart_shapes_v3';
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const FIB_COLORS = ['#8b96a3', '#4f9dff', '#3fb950', '#f7931a', '#3fb950', '#4f9dff', '#8b96a3'];

  const RANGES = {
    '1m': { label: '1m', interval: '1m', limit: 180 },
    '15m': { label: '15m', interval: '15m', limit: 192 },
    '1h': { label: '1H', interval: '1h', limit: 168 },
    '4h': { label: '4H', interval: '4h', limit: 180 },
    '1d': { label: '1D', interval: '1d', limit: 365 },
    '1w': { label: '1W', interval: '1w', limit: 260 },
    'all': { label: 'ALL', interval: null, limit: null },
  };

  let currentRange = '1h';
  let chartMode = 'candle'; // 'candle' | 'line'
  let candles = []; // {time (unix detik), open, high, low, close}
  let showSMA = false;
  let showEMA = false;
  let ws = null;
  let historyCache = null;

  // alat gambar aktif: 'cursor' | 'trend' | 'hline' | 'fib' | 'text'
  let activeTool = 'cursor';
  let pendingPoint = null; // titik pertama buat alat 2-klik (trend/fib)
  let shapes = { trend: [], hLines: [], fibs: [], texts: [] }; // per-timeframe, DATA-SPACE
  let candlePriceLineRefs = [], areaPriceLineRefs = [];
  let candleMarkersPrim = null, areaMarkersPrim = null;

  const priceEl = document.getElementById('btc-price');
  const changeEl = document.getElementById('btc-change');
  const liveDot = document.getElementById('live-dot');
  const chartContainer = document.getElementById('btc-chart');
  const wrap = document.getElementById('btc-chart-wrap');
  const drawCanvas = document.getElementById('btc-chart-draw');
  if (!chartContainer || !window.LightweightCharts) return; // widget/lib gak ada, skip

  function fmtUsd(n) {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
  }

  async function updatePrice() {
    try {
      const res = await fetch(PRICE_URL);
      const data = await res.json();
      const price = parseFloat(data.lastPrice);
      const changePct = parseFloat(data.priceChangePercent);
      priceEl.textContent = fmtUsd(price);
      changeEl.textContent = (changePct >= 0 ? '📈 +' : '📉 ') + changePct.toFixed(2) + '% (24j)';
      changeEl.className = 'price-change ' + (changePct >= 0 ? 'up' : 'down');
    } catch (e) {
      priceEl.textContent = 'Gagal muat';
    }
  }

  // --- chart utama ---
  const chart = LightweightCharts.createChart(chartContainer, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#8b96a3', fontFamily: 'Inter, sans-serif', fontSize: 11, attributionLogo: false },
    grid: {
      vertLines: { color: 'rgba(139,150,163,0.08)' },
      horzLines: { color: 'rgba(139,150,163,0.08)' },
    },
    rightPriceScale: { borderColor: 'rgba(139,150,163,0.2)' },
    timeScale: { borderColor: 'rgba(139,150,163,0.2)', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  // autoSize:true KADANG gak nangkep ukuran container yang bener di beberapa kondisi timing/hosting
  // (ketauan live: canvas internal nyangkut di default 300x150 browser padahal CSS udah 786x292 --
  // isinya digambar di buffer kecil terus di-stretch CSS, jadi keliatan "kepotong"/kosong sebagian).
  // Resize manual eksplisit sebagai jaring pengaman, gak gantiin autoSize, cuma nambahin.
  function forceResize() {
    const rect = chartContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    chart.resize(rect.width, rect.height);
    // resize() ganti ukuran canvas TAPI gak otomatis re-fit rentang waktu yang lagi ketampil --
    // tanpa ini, candle yang udah kegambar sebelumnya tetep kepake bar-spacing/posisi LAMA,
    // jadi keliatan "nyempil" di sebagian canvas yang sekarang lebih lebar (ini akar masalah
    // "kepotong" yang tersisa walau canvas internal udah bener ukurannya).
    if (candles.length > 1) chart.timeScale().fitContent();
  }

  const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#3fb950', downColor: '#f85149', borderVisible: false,
    wickUpColor: '#3fb950', wickDownColor: '#f85149',
    visible: chartMode === 'candle',
  });
  const areaSeries = chart.addSeries(LightweightCharts.AreaSeries, {
    lineColor: '#3fb950', topColor: 'rgba(63,185,80,0.25)', bottomColor: 'rgba(63,185,80,0)',
    lineWidth: 2, visible: chartMode === 'line',
  });
  const smaSeries = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#4f9dff', lineWidth: 1, visible: false, priceLineVisible: false, lastValueVisible: false,
  });
  const emaSeries = chart.addSeries(LightweightCharts.LineSeries, {
    color: '#c77dff', lineWidth: 1, visible: false, priceLineVisible: false, lastValueVisible: false,
  });
  const mainSeries = () => (chartMode === 'candle' ? candleSeries : areaSeries);

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (i === period - 1) {
        prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      } else if (i >= period) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }
  function indicatorSeriesData(period, fn) {
    if (candles.length < period) return [];
    const closes = candles.map((c) => c.close);
    const values = fn(closes, period);
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      if (values[i] !== null) out.push({ time: candles[i].time, value: values[i] });
    }
    return out;
  }
  function refreshIndicators() {
    smaSeries.setData(showSMA ? indicatorSeriesData(20, sma) : []);
    emaSeries.setData(showEMA ? indicatorSeriesData(50, ema) : []);
  }

  function applyCandlesToChart() {
    candleSeries.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    const closes = candles.map((c) => c.close);
    const trendUp = closes.length > 1 ? closes[closes.length - 1] >= closes[0] : true;
    areaSeries.applyOptions({
      lineColor: trendUp ? '#3fb950' : '#f85149',
      topColor: trendUp ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)',
      bottomColor: trendUp ? 'rgba(63,185,80,0)' : 'rgba(248,81,73,0)',
    });
    areaSeries.setData(candles.map((c) => ({ time: c.time, value: c.close })));
    refreshIndicators();
    chart.timeScale().fitContent();
  }

  // --- persist semua bentuk gambar per timeframe, koordinat DATA-SPACE (waktu + harga asli) ---
  function loadAllShapes() {
    try { return JSON.parse(localStorage.getItem(SHAPES_STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveShapes() {
    const all = loadAllShapes();
    all[currentRange] = shapes;
    try { localStorage.setItem(SHAPES_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function loadShapesForCurrentRange() {
    const all = loadAllShapes();
    shapes = all[currentRange] || { trend: [], hLines: [], fibs: [], texts: [] };
  }

  // --- Garis Horizontal & Fibonacci: native price line API, ditaruh di KEDUA series
  // (candle+area) sekaligus biar gak perlu re-create pas toggle mode candle/garis ---
  function clearPriceLines() {
    candlePriceLineRefs.forEach((pl) => { try { candleSeries.removePriceLine(pl); } catch (e) {} });
    areaPriceLineRefs.forEach((pl) => { try { areaSeries.removePriceLine(pl); } catch (e) {} });
    candlePriceLineRefs = []; areaPriceLineRefs = [];
  }
  function renderPriceLevels() {
    clearPriceLines();
    const defs = [];
    shapes.hLines.forEach((price) => defs.push({
      price, color: '#f7931a', lineStyle: LightweightCharts.LineStyle.Dashed, title: '',
    }));
    shapes.fibs.forEach((f) => {
      FIB_LEVELS.forEach((lv, i) => {
        defs.push({
          price: f.p1 + (f.p2 - f.p1) * lv, color: FIB_COLORS[i],
          lineStyle: LightweightCharts.LineStyle.Dotted, title: (lv * 100).toFixed(1) + '%',
        });
      });
    });
    defs.forEach((d) => {
      candlePriceLineRefs.push(candleSeries.createPriceLine({ ...d, lineWidth: 1, axisLabelVisible: true }));
      areaPriceLineRefs.push(areaSeries.createPriceLine({ ...d, lineWidth: 1, axisLabelVisible: true }));
    });
  }

  // --- Teks: native series markers, snap ke waktu candle terdekat ---
  function nearestCandleTime(t) {
    if (!candles.length) return null;
    let best = candles[0].time, bestDiff = Math.abs(candles[0].time - t);
    for (const c of candles) {
      const diff = Math.abs(c.time - t);
      if (diff < bestDiff) { bestDiff = diff; best = c.time; }
    }
    return best;
  }
  function renderMarkers() {
    const markers = shapes.texts
      .map((t) => ({ time: t.time, position: 'aboveBar', color: '#f7931a', shape: 'circle', text: t.text }))
      .sort((a, b) => a.time - b.time);
    if (!candleMarkersPrim) candleMarkersPrim = LightweightCharts.createSeriesMarkers(candleSeries, []);
    if (!areaMarkersPrim) areaMarkersPrim = LightweightCharts.createSeriesMarkers(areaSeries, []);
    candleMarkersPrim.setMarkers(markers);
    areaMarkersPrim.setMarkers(markers);
  }

  // --- Garis Tren: gak ada primitive native buat garis diagonal bebas, jadi dirender di
  // overlay canvas transparan di atas chart, dihitung ULANG tiap kali dipanggil dari
  // koordinat data (waktu/harga) -> pixel SEKARANG, otomatis ikut kalau chart di-pan/zoom ---
  const octx = drawCanvas ? drawCanvas.getContext('2d') : null;

  function resizeOverlay() {
    if (!drawCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = chartContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    drawCanvas.width = rect.width * dpr;
    drawCanvas.height = rect.height * dpr;
    drawCanvas.style.width = rect.width + 'px';
    drawCanvas.style.height = rect.height + 'px';
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function strokeDataLine(l, color) {
    const ts = chart.timeScale();
    const series = mainSeries();
    const x1 = ts.timeToCoordinate(l.t1), x2 = ts.timeToCoordinate(l.t2);
    const y1 = series.priceToCoordinate(l.p1), y2 = series.priceToCoordinate(l.p2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    octx.strokeStyle = color;
    octx.lineWidth = 1.5;
    octx.beginPath();
    octx.moveTo(x1, y1);
    octx.lineTo(x2, y2);
    octx.stroke();
  }

  function redrawOverlay(previewLine) {
    if (!octx) return;
    resizeOverlay();
    const w = drawCanvas.clientWidth, h = drawCanvas.clientHeight;
    octx.clearRect(0, 0, w, h);
    shapes.trend.forEach((l) => strokeDataLine(l, '#f7931a'));
    if (previewLine) strokeDataLine(previewLine, 'rgba(247,147,26,0.6)');
  }

  function setLiveIndicator(isLive) {
    if (!liveDot) return;
    liveDot.style.display = isLive ? 'inline-block' : 'none';
  }

  function connectWebSocket(interval) {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (!interval) { setLiveIndicator(false); return; }
    try {
      ws = new WebSocket(WS_BASE + interval);
      ws.onopen = () => setLiveIndicator(true);
      ws.onclose = () => setLiveIndicator(false);
      ws.onerror = () => setLiveIndicator(false);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const k = msg.k;
        if (!k) return;
        const liveCandle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c };
        const lastIdx = candles.length - 1;
        if (lastIdx >= 0 && candles[lastIdx].time === liveCandle.time) {
          candles[lastIdx] = liveCandle;
        } else {
          candles.push(liveCandle);
          const cfg = RANGES[currentRange];
          if (cfg.limit && candles.length > cfg.limit) candles.shift();
        }
        candleSeries.update({ time: liveCandle.time, open: liveCandle.open, high: liveCandle.high, low: liveCandle.low, close: liveCandle.close });
        areaSeries.update({ time: liveCandle.time, value: liveCandle.close });
        refreshIndicators();
        redrawOverlay();
      };
    } catch (e) {
      setLiveIndicator(false);
    }
  }

  async function loadHistoryAll() {
    if (historyCache) return historyCache;
    const res = await fetch('data/btc-history.json');
    const raw = await res.json();
    historyCache = raw.map((c) => ({ time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close }));
    return historyCache;
  }

  async function loadChart(rangeKey) {
    currentRange = rangeKey;
    document.querySelectorAll('.tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === rangeKey));
    const cfg = RANGES[rangeKey];
    try {
      if (rangeKey === 'all') {
        candles = await loadHistoryAll();
        connectWebSocket(null); // data statis, gak ada live stream buat "All Time"
      } else {
        const res = await fetch(`${KLINES_URL}?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`);
        const raw = await res.json();
        candles = raw.map((r) => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
        connectWebSocket(cfg.interval);
      }
      loadShapesForCurrentRange();
      forceResize(); // pastikan canvas internal udah ukuran bener SEBELUM fitContent() ngitung layout
      applyCandlesToChart();
      renderPriceLevels();
      renderMarkers();
      redrawOverlay();
    } catch (e) {
      console.error('Gagal muat grafik:', e.message);
    }
  }

  // --- toolbar alat gambar: klik ikon buat pilih alat, klik di chart buat pakai ---
  function setActiveTool(tool) {
    activeTool = tool;
    pendingPoint = null;
    document.querySelectorAll('.chart-tool-btn[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    if (drawCanvas) drawCanvas.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
    if (wrap) wrap.style.cursor = tool === 'cursor' ? '' : 'crosshair';
    redrawOverlay();
  }

  function getPos(evt) {
    const rect = drawCanvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  function pixelToData(pos) {
    const t = chart.timeScale().coordinateToTime(pos.x);
    const p = mainSeries().coordinateToPrice(pos.y);
    return { t, p };
  }

  function onCanvasClick(evt) {
    const d = pixelToData(getPos(evt));
    if (d.t === null || d.p === null) return;

    if (activeTool === 'hline') {
      shapes.hLines.push(d.p);
      saveShapes();
      renderPriceLevels();
      setActiveTool('cursor');
      return;
    }
    if (activeTool === 'text') {
      const txt = window.prompt('Teks anotasi:');
      if (txt) {
        const snapped = nearestCandleTime(d.t);
        if (snapped !== null) {
          shapes.texts.push({ time: snapped, text: txt });
          saveShapes();
          renderMarkers();
        }
      }
      setActiveTool('cursor');
      return;
    }
    // alat 2 klik: trend / fib
    if (activeTool === 'trend' || activeTool === 'fib') {
      if (!pendingPoint) {
        pendingPoint = d;
        return;
      }
      const shape = { t1: pendingPoint.t, p1: pendingPoint.p, t2: d.t, p2: d.p };
      if (activeTool === 'trend') shapes.trend.push(shape);
      else shapes.fibs.push(shape);
      pendingPoint = null;
      saveShapes();
      if (activeTool === 'trend') redrawOverlay();
      else renderPriceLevels();
      setActiveTool('cursor');
    }
  }
  function onCanvasMove(evt) {
    if (!pendingPoint) return;
    const d = pixelToData(getPos(evt));
    if (d.t === null || d.p === null) return;
    redrawOverlay({ t1: pendingPoint.t, p1: pendingPoint.p, t2: d.t, p2: d.p });
  }

  if (drawCanvas) {
    drawCanvas.addEventListener('click', onCanvasClick);
    drawCanvas.addEventListener('mousemove', onCanvasMove);
  }

  document.querySelectorAll('.chart-tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });

  const clearBtn = document.getElementById('clear-draw');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      shapes = { trend: [], hLines: [], fibs: [], texts: [] };
      saveShapes();
      renderPriceLevels();
      renderMarkers();
      redrawOverlay();
    });
  }

  const modeBtn = document.getElementById('chart-mode-toggle');
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      chartMode = chartMode === 'candle' ? 'line' : 'candle';
      modeBtn.textContent = chartMode === 'candle' ? '📊 Candle' : '📈 Garis';
      candleSeries.applyOptions({ visible: chartMode === 'candle' });
      areaSeries.applyOptions({ visible: chartMode === 'line' });
      redrawOverlay();
    });
  }

  const smaCheck = document.getElementById('indicator-sma');
  if (smaCheck) smaCheck.addEventListener('change', () => { showSMA = smaCheck.checked; refreshIndicators(); });
  const emaCheck = document.getElementById('indicator-ema');
  if (emaCheck) emaCheck.addEventListener('change', () => { showEMA = emaCheck.checked; refreshIndicators(); });

  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadChart(btn.dataset.tf));
  });

  chart.timeScale().subscribeVisibleTimeRangeChange(() => redrawOverlay());
  window.addEventListener('resize', () => { forceResize(); redrawOverlay(); });
  // Pinch-zoom (HP) & sebagian browser zoom (Ctrl +/-) ubah devicePixelRatio efektif tanpa
  // selalu memicu 'resize' biasa -- visualViewport nangkep itu, overlay canvas custom kita
  // (bukan dikelola LightweightCharts) perlu di-resize ulang biar gak keliatan "kepotong"/mismatch.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { forceResize(); redrawOverlay(); });
  }
  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });

  updatePrice();
  setInterval(updatePrice, 15000);
  loadChart(currentRange);
  // Jaring pengaman tambahan: beberapa saat setelah load pertama, layout/font udah pasti settle
  // sepenuhnya -- resize ulang sekali lagi buat nutup celah timing kalau autoSize sempat ngukur
  // container yang belum final (ini akar masalah "kepotong" yang dilaporkan live).
  setTimeout(forceResize, 300);
  setTimeout(forceResize, 1200);
})();
