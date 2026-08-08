// Widget harga live + grafik candlestick/area multi-timeframe + indikator + alat gambar garis.
// Pakai TradingView Lightweight Charts (self-hosted, lightweight-charts.standalone.production.js) --
// library resmi open-source (Apache 2.0) dari TradingView sendiri, jadi pan/zoom/crosshair
// beneran ala TradingView, bukan tiruan manual lagi. Tetap zero-dependency runtime: file-nya
// di-download sekali dan disimpan statis di repo (lihat header file library-nya).
// Live movement dari Binance WebSocket (bukan cuma polling).
// "All Time" pakai data historis 2014+ yang di-bundle statis (data/btc-history.json).
// Garis gambar TERSIMPAN di localStorage, koordinat DATA-SPACE (waktu asli + harga asli) --
// jadi tetap valid dipakai lagi walau chart di-resize/pan/zoom, beda dari versi canvas manual
// dulu yang cuma bisa pakai koordinat relatif fraksi 0-1.

(function () {
  const PRICE_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  const KLINES_URL = 'https://api.binance.com/api/v3/klines';
  const WS_BASE = 'wss://stream.binance.com:9443/ws/btcusdt@kline_';
  const LINES_STORAGE_KEY = 'kaela_chart_lines_v2';

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
  let drawnLines = []; // {t1,p1,t2,p2} DATA-SPACE (waktu unix detik + harga asli)
  let showSMA = false;
  let showEMA = false;
  let ws = null;
  let historyCache = null;
  let drawMode = false;

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
    layout: { background: { color: 'transparent' }, textColor: '#8b96a3', fontFamily: 'Inter, sans-serif', fontSize: 11 },
    grid: {
      vertLines: { color: 'rgba(139,150,163,0.08)' },
      horzLines: { color: 'rgba(139,150,163,0.08)' },
    },
    rightPriceScale: { borderColor: 'rgba(139,150,163,0.2)' },
    timeScale: { borderColor: 'rgba(139,150,163,0.2)', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

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
    redrawOverlay();
  }

  // --- persist garis gambar per timeframe, koordinat DATA-SPACE (waktu + harga asli) ---
  function loadAllSavedLines() {
    try { return JSON.parse(localStorage.getItem(LINES_STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveLinesForCurrentRange() {
    const all = loadAllSavedLines();
    all[currentRange] = drawnLines;
    try { localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function loadLinesForCurrentRange() {
    const all = loadAllSavedLines();
    drawnLines = all[currentRange] || [];
  }

  // --- overlay canvas: render garis gambar user di atas chart, posisi dihitung ULANG
  // tiap kali dipanggil dari koordinat data (waktu/harga) -> pixel saat ini, jadi otomatis
  // ikut kalau chart di-pan/zoom/resize ---
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

  function redrawOverlay(previewLine) {
    if (!octx) return;
    resizeOverlay();
    const w = drawCanvas.clientWidth, h = drawCanvas.clientHeight;
    octx.clearRect(0, 0, w, h);
    const ts = chart.timeScale();
    const series = mainSeries();
    octx.strokeStyle = '#f7931a';
    octx.lineWidth = 1.5;
    const allLines = previewLine ? drawnLines.concat([previewLine]) : drawnLines;
    allLines.forEach((l) => {
      const x1 = ts.timeToCoordinate(l.t1), x2 = ts.timeToCoordinate(l.t2);
      const y1 = series.priceToCoordinate(l.p1), y2 = series.priceToCoordinate(l.p2);
      if (x1 === null || x2 === null || y1 === null || y2 === null) return;
      octx.beginPath();
      octx.moveTo(x1, y1);
      octx.lineTo(x2, y2);
      octx.stroke();
    });
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
      loadLinesForCurrentRange();
      applyCandlesToChart();
    } catch (e) {
      console.error('Gagal muat grafik:', e.message);
    }
  }

  // --- gambar garis: mouse + touch, aktif cuma pas draw mode ON (biar gak bentrok sama pan/zoom chart) ---
  let drawing = null;

  function getPos(evt) {
    const rect = drawCanvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }
  function pixelToData(pos) {
    const t = chart.timeScale().coordinateToTime(pos.x);
    const p = mainSeries().coordinateToPrice(pos.y);
    return { t, p };
  }
  function startDraw(evt) { evt.preventDefault(); drawing = getPos(evt); }
  function moveDraw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    const pos = getPos(evt);
    const d1 = pixelToData(drawing), d2 = pixelToData(pos);
    if (d1.t === null || d2.t === null || d1.p === null || d2.p === null) return;
    redrawOverlay({ t1: d1.t, p1: d1.p, t2: d2.t, p2: d2.p });
  }
  function endDraw(evt) {
    if (!drawing) return;
    const pos = getPos(evt.changedTouches ? { clientX: evt.changedTouches[0].clientX, clientY: evt.changedTouches[0].clientY } : evt);
    const d1 = pixelToData(drawing), d2 = pixelToData(pos);
    drawing = null;
    if (d1.t !== null && d2.t !== null && d1.p !== null && d2.p !== null) {
      drawnLines.push({ t1: d1.t, p1: d1.p, t2: d2.t, p2: d2.p });
      saveLinesForCurrentRange();
    }
    redrawOverlay();
  }

  function setDrawMode(on) {
    drawMode = on;
    if (drawCanvas) drawCanvas.style.pointerEvents = on ? 'auto' : 'none';
    const btn = document.getElementById('draw-mode-toggle');
    if (btn) btn.classList.toggle('active', on);
    if (wrap) wrap.style.cursor = on ? 'crosshair' : '';
  }

  if (drawCanvas) {
    drawCanvas.addEventListener('mousedown', startDraw);
    drawCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);
    drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
    drawCanvas.addEventListener('touchmove', moveDraw, { passive: false });
    drawCanvas.addEventListener('touchend', endDraw);
  }

  const drawModeBtn = document.getElementById('draw-mode-toggle');
  if (drawModeBtn) drawModeBtn.addEventListener('click', () => setDrawMode(!drawMode));

  const clearBtn = document.getElementById('clear-draw');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      drawnLines = [];
      saveLinesForCurrentRange();
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
  window.addEventListener('resize', () => redrawOverlay());
  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });

  updatePrice();
  setInterval(updatePrice, 15000);
  loadChart(currentRange);
})();
