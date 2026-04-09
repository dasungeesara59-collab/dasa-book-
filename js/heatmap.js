/**
 * 📈 BOOKMAP PRO ENGINE V13.0 — PRECISION WALL
 * 100% Aesthetic Replica with Advanced Liquidity Noise Filtering
 */

let heatmapActive = false;
let heatmapPair = '';
let depthWS = null;
let tradeWS = null;

// Core Data Buffers
let heatSnapshots = [];
let tradeBubbles = [];
let cvdData = [];
let deepDOMData = { bids: [], asks: [] }; // 1000 level depth buffer
const MAX_SNAPSHOTS = 15000;
const MAX_BUBBLES = 50000; 
const MAX_CVD = 20000;
let klines = []; // { time, open, high, low, close }
const MAX_KLINES = 5000;      // Increased for history

// 🧱 Absorption Zones (fetched from bot API)
let absorptionZones = []; // { price, side, strength, ageSeconds }
let absorptionZonePollInterval = null;

// 🏆 Global Liquidity Aggregation
let globalClusters = [];
let globalRawDepth = []; // Array of { id, bids, asks }
let globalLiquidityPollInterval = null;

let isProMode = false;
let dashboardResizeObserver = null;
let deepDepthInterval = null;

async function pollGlobalLiquidity() {
    if (!heatmapActive || !heatmapPair) return;
    try {
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/bot/liquidity/global-dom?pair=${heatmapPair}`);
        const data = await res.json();
        if (data.success && data.data) {
            if (data.data.clusters) globalClusters = data.data.clusters;
            if (data.data.rawResults) globalRawDepth = data.data.rawResults;
        }
    } catch (e) { /* non-critical */ }
}

async function pollAbsorptionZones() {
    if (!heatmapActive || !heatmapPair) return;
    try {
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/bot/absorption-zones`);
        const data = await res.json();
        if (data.success && data.zones) {
            const pairZones = data.zones[heatmapPair] || [];
            absorptionZones = pairZones;
        }
    } catch (e) { /* non-critical */ }
}


// 🛡️ Safe Storage Wrapper (Hardware Acceleration for Browser Blocking)
const SafeStorage = {
    getItem: (key) => {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem: (key, val) => {
        try { localStorage.setItem(key, val); } catch (e) { }
    }
};

// ⏳ Settings & State
let TIME_WINDOW_MS = parseInt(SafeStorage.getItem('heatmapDefaultTF')) || 120000;
let currentCVD = 0;
let tradeCounter = 0;
let lastTPSUpdate = Date.now();
let currentTPS = 0;
let bubbleScale = parseFloat(SafeStorage.getItem('heatmapBubbleScale')) || 1.0;
let heatSensitivity = parseFloat(SafeStorage.getItem('heatmapHeatSensitivity')) || 0.3;
let domAggregation = parseFloat(SafeStorage.getItem('heatmapDomAgg')) || 0;
let priceZoom = parseFloat(SafeStorage.getItem('heatmapPriceZoom')) || 1.0;

// 🔍 Interaction & View State
let minPrice = 0;
let maxPrice = 0;
let currentPrice = 0;
let dragM = 0; // 0=none, 1=main(pan), 2=dom(zoomY), 3=time(zoomX)
let isAutoTick = true;
let lastMouseY = 0;
let lastMouseX = 0;
let timeOffset = 0; // ms offset from "now"
let isLive = true;
let tickSize = 1.0; // Global standardized tick size

// Rendering State
let lastRenderTime = 0;
let lastDOMData = { bids: [], asks: [] };
let domHeatHits = {}; // Real-time trade hits for DOM sidebar: { price: { qty, time } }
let lastGlobalMaxUpdate = 0;
let cachedGlobalMaxQty = 1;

/**
 * 📊 Returns a unified order book merging live updates and deep snapshots.
 */
function getMergedDOM() {
    const merged = { bids: {}, asks: {} };
    // 1. Start with high-precision live updates
    if (lastDOMData.bids) {
        lastDOMData.bids.forEach(l => merged.bids[l[0]] = l[1]);
        lastDOMData.asks.forEach(l => merged.asks[l[0]] = l[1]);
    }
    // 2. Fill gaps with deep snapshot (if not already in merged)
    if (deepDOMData.bids) {
        deepDOMData.bids.forEach(l => { if (!(l[0] in merged.bids)) merged.bids[l[0]] = l[1]; });
        deepDOMData.asks.forEach(l => { if (!(l[0] in merged.asks)) merged.asks[l[0]] = l[1]; });
    }
    return merged;
}

/**
 * 📊 Returns binned DOM data for consistent rendering between chart and sidebar.
 */
function getBinnedDOM(startPrice, endPrice, step) {
    const merged = getMergedDOM();
    const bins = {};
    
    const process = (data, isAsk) => {
        Object.keys(data).forEach(pStr => {
            const p = parseFloat(pStr);
            if (p < startPrice - step*5 || p > endPrice + step*5) return;
            const bin = Math.round(p / step) * step;
            if (!bins[bin]) bins[bin] = { q: 0, isAsk };
            bins[bin].q += data[pStr];
        });
    };
    
    process(merged.bids, false);
    process(merged.asks, true);
    return bins;
}

// 🔊 AUDIO ENGINE
let isMuted = SafeStorage.getItem('heatmapMuted') === 'true';
let audioCtx = null;

async function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}

// 🔊 Add Window-level click to unlock audio
window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}, { once: true });

function playSynthSound(frequency, type, duration, volume = 0.1) {
    if (isMuted || !audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type; // 'sine', 'square', 'sawtooth', 'triangle'
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) { console.warn('Audio play failed:', e); }
}

function toggleMute() {
    isMuted = !isMuted;
    SafeStorage.setItem('heatmapMuted', isMuted);
    const btn = document.getElementById('muteBtn');
    if (btn) {
        btn.innerHTML = isMuted ? '🔇' : '🔊';
        btn.style.opacity = isMuted ? '0.4' : '0.8';
    }
    if (!isMuted) initAudio();
}

// Export for other scripts if needed
window.triggerSignalSound = () => {
    if (document.getElementById('signalSound')?.checked) {
        // High-pitched chime for signals
        initAudio().then(() => {
            playSynthSound(880, 'sine', 0.5, 0.15);
            setTimeout(() => playSynthSound(1320, 'sine', 0.8, 0.1), 150);
        });
    }
};

window.testAudio = (type) => {
    initAudio().then(() => {
        if (type === 'whale') {
            playSynthSound(150, 'triangle', 0.5, 0.2);
        } else {
            playSynthSound(880, 'sine', 0.5, 0.15);
            setTimeout(() => playSynthSound(1320, 'sine', 0.8, 0.1), 150);
        }
    });
};

// 💎 CACHED OFFSCREEN GRADIENT FOR FAST 3D BUBBLES
const bubbleGlossCanvas = document.createElement('canvas');
bubbleGlossCanvas.width = 100;
bubbleGlossCanvas.height = 100;
const glossCtx = bubbleGlossCanvas.getContext('2d');
const glossGrad = glossCtx.createRadialGradient(35, 35, 5, 50, 50, 50);
glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
glossGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
glossGrad.addColorStop(0.8, 'rgba(0, 0, 0, 0.3)');
glossGrad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
glossCtx.fillStyle = glossGrad;
glossCtx.fillRect(0, 0, 100, 100);

// 🎨 ATAS "Hot-Map" Vivid Palette — starts from deep blue so ANY data is visible
const HEAT_COLORS = [
    { threshold: 0.0,  color: [0,  10,  40] },   // Near-zero: very dark navy (visible bg)
    { threshold: 0.08, color: [0,  30,  100] },  // Low: dark blue
    { threshold: 0.2,  color: [0,  80,  220] },  // Medium-low: blue
    { threshold: 0.4,  color: [0,  200, 255] },  // Medium: cyan
    { threshold: 0.6,  color: [0,  255, 180] },  // Medium-high: teal
    { threshold: 0.75, color: [255, 255, 0] },   // High: yellow
    { threshold: 0.88, color: [255, 120, 0] },   // Very high: orange
    { threshold: 1.0,  color: [255, 0,   0] }    // Max: red
];

function getVividColor(intensity, alpha = 1.0) {
    if (intensity <= 0) return 'rgba(0,0,0,0)';

    // ATAS Style: Sharper transitions
    const idx = HEAT_COLORS.findIndex(c => c.threshold >= intensity);
    if (idx <= -1) {
        const c = HEAT_COLORS[HEAT_COLORS.length - 1].color;
        return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }
    if (idx <= 0) {
        const c = HEAT_COLORS[1].color;
        return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }

    const lower = HEAT_COLORS[idx - 1];
    const upper = HEAT_COLORS[idx];
    const range = upper.threshold - lower.threshold;
    const factor = (intensity - lower.threshold) / range;

    const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * factor);
    const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * factor);
    const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * factor);

    return `rgba(${r},${g},${b},${alpha})`;
}

function updateBubbleScale(val) {
    bubbleScale = parseFloat(val);
    SafeStorage.setItem('heatmapBubbleScale', val);
}

function updateHeatSensitivity(val) {
    heatSensitivity = parseFloat(val);
    SafeStorage.setItem('heatmapHeatSensitivity', val);
}

function updateTimeZoom(val) {
    TIME_WINDOW_MS = parseInt(val) * 1000;
    SafeStorage.setItem('heatmapDefaultTF', TIME_WINDOW_MS);
    
    // Sync sliders
    const proX = document.getElementById('proZoomX');
    if (proX) proX.value = val;
    const dashX = document.getElementById('timeZoomSlider');
    if (dashX) dashX.value = val;
}

function updateDomAggregation(val) {
    domAggregation = parseFloat(val);
    SafeStorage.setItem('heatmapDomAgg', val);
}

function updatePriceZoom(val) {
    priceZoom = parseFloat(val);
    SafeStorage.setItem('heatmapPriceZoom', val);
    
    // Sync Pro Toolbar slider if it exists
    const proS = document.getElementById('proZoomY');
    if (proS) proS.value = val;
    
    // Sync Dashboard slider if it exists
    const dashS = document.getElementById('priceZoomSlider');
    if (dashS) dashS.value = val;
}

function toggleAutoTick() {
    isAutoTick = !isAutoTick;
    const btn = document.getElementById('autoTickBtn');
    if (btn) btn.classList.toggle('active', isAutoTick);
}

function setManualTick(val) {
    const v = parseFloat(val);
    if (!isNaN(v) && v > 0) {
        tickSize = v;
        isAutoTick = false;
        const btn = document.getElementById('autoTickBtn');
        if (btn) btn.classList.remove('active');
    }
}

function calculateAutoTick() {
    if (!currentPrice || currentPrice === 0) return;
    const priceRange = maxPrice - minPrice;
    
    // Target roughly 45-55 levels for Footprint-style high density
    const rawTick = priceRange / 50;
    
    // Snapping to clean human-readable ticks
    const cleanTicks = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 200.0, 500.0, 1000.0];
    let bestTick = cleanTicks[0];
    let minDist = Math.abs(rawTick - bestTick);
    
    for (const t of cleanTicks) {
        const dist = Math.abs(rawTick - t);
        if (dist < minDist) {
            minDist = dist;
            bestTick = t;
        }
    }
    
    tickSize = bestTick;
    const input = document.getElementById('tickInput');
    if (input) input.value = tickSize >= 1 ? tickSize : tickSize.toFixed(4);
}

function setTimeframe(ms) {
    TIME_WINDOW_MS = ms;
    SafeStorage.setItem('heatmapDefaultTF', ms);
    document.querySelectorAll('.tf-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'none';
        b.style.color = '#888';
    });
    // Update both dashboard and pro toolbar buttons
    const btns = document.querySelectorAll(`.tf-btn[onclick="setTimeframe(${ms})"]`);
    btns.forEach(b => {
        b.classList.add('active');
        b.style.background = '#3b82f6';
        b.style.color = '#fff';
    });
    // Fetch more history for larger timeframes
    const tradeLimit = ms >= 900000 ? 5000 : 1000;
    loadTradeHistory(heatmapPair, tradeLimit);
}

function toggleProMode() {
    isProMode = !isProMode;
    const modal = document.getElementById('heatmapModal');
    const dashboard = document.querySelector('.main-content');

    if (isProMode) {
        modal.classList.add('pro-mode');
        // Copy timeframe buttons to pro toolbar
        const tfGroup = document.getElementById('proTfGroup');
        const originalTfs = document.querySelector('.tf-btn').parentNode.innerHTML;
        tfGroup.innerHTML = originalTfs;

        // Sync sliders
        document.getElementById('proHeat').value = heatSensitivity;
        const proX = document.getElementById('proZoomX');
        if (proX) proX.value = TIME_WINDOW_MS / 1000;
        const proY = document.getElementById('proZoomY');
        if (proY) proY.value = priceZoom;
    } else {
        modal.classList.remove('pro-mode');
    }

    // Force immediate resize
    handleResize();
}

function handleResize() {
    const canvases = ['heatmapCanvas', 'domCanvas', 'timeCanvas'];
    let allSized = true;
    canvases.forEach(id => {
        const c = document.getElementById(id);
        const container = c ? c.parentElement : null;
        if (c && container) {
            const w = container.offsetWidth || container.clientWidth;
            const h = container.offsetHeight || container.clientHeight;

            if (w < 2 || h < 2) {
                allSized = false;
                return;
            }

            const dpr = window.devicePixelRatio || 1;
            c.width = w * dpr;
            c.height = h * dpr;
            const ctx = c.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    });
    return allSized;
}

function ensureCanvasSized() {
    // Retry every 100ms until canvas has real dimensions (max 30 tries = 3 seconds)
    let tries = 0;
    const tryResize = () => {
        if (!heatmapActive) return;
        const done = handleResize();
        if (!done && tries < 30) {
            tries++;
            setTimeout(tryResize, 100);
        }
    };
    tryResize();
}

window.addEventListener('resize', handleResize);

function closeWebSockets() {
    if (depthWS) {
        try { depthWS.close(); } catch (e) {}
        depthWS = null;
    }
    if (tradeWS) {
        try { tradeWS.close(); } catch (e) {}
        tradeWS = null;
    }
}

async function openHeatmap(pair) {
    if (!pair) return;
    
    // 1. Cleanup existing resources
    heatmapActive = false; // Stop loops
    closeWebSockets();
    if (deepDepthInterval) clearInterval(deepDepthInterval);
    if (absorptionZonePollInterval) clearInterval(absorptionZonePollInterval);
    if (globalLiquidityPollInterval) clearInterval(globalLiquidityPollInterval);
    
    // 2. Reset state for new pair
    heatmapPair = pair; 
    heatmapActive = true; 
    heatSnapshots = []; 
    tradeBubbles = []; 
    cvdData = []; 
    currentCVD = 0;
    minPrice = 0; // Reset price axis
    maxPrice = 0; // Reset price axis
    currentPrice = 0;
    
    document.getElementById('heatmapModal').style.display = 'block';
    const pairBadge = document.getElementById('heatmapPairBadge');
    if (pairBadge) {
        if (pairBadge.tagName === 'INPUT') pairBadge.value = pair;
        else pairBadge.innerText = pair;
    }

    // Ensure canvas has correct dimensions with retry mechanism
    ensureCanvasSized();
    setTimeout(handleResize, 200);
    setTimeout(handleResize, 500);
    setTimeout(handleResize, 1000);

    const dashboard = document.getElementById('heatmapDashboard');
    if (dashboard) {
        if (dashboardResizeObserver) dashboardResizeObserver.disconnect();
        dashboardResizeObserver = new ResizeObserver(() => handleResize());
        dashboardResizeObserver.observe(dashboard);
    }

    // Sync UI Sliders
    document.querySelectorAll('#bubbleSizeSlider, #proSize').forEach(s => s.value = bubbleScale);
    document.querySelectorAll('#heatFilterSlider, #proHeat').forEach(s => s.value = heatSensitivity);
    document.querySelectorAll('#timeZoomSlider, #proZoomX').forEach(s => s.value = TIME_WINDOW_MS / 1000);
    document.querySelectorAll('#priceZoomSlider, #proZoomY').forEach(s => s.value = priceZoom);
    document.querySelectorAll('#domAggSlider').forEach(s => s.value = domAggregation);

    setTimeframe(TIME_WINDOW_MS);
    setupInteractions();

    // 🚀 START RENDERLOOP IMMEDIATELY so canvas shows 'Connecting...' instead of black
    // Data loads below are async and can take 5-15 seconds for large history

    // 💥 FORCE canvas dimensions NOW using viewport as absolute fallback
    // This ensures the canvas is NEVER 0x0 when the render loop starts
    (function forceSizeCanvases() {
        const dpr = window.devicePixelRatio || 1;
        const dashboard = document.getElementById('heatmapDashboard');
        const dashW = dashboard ? (dashboard.offsetWidth || dashboard.clientWidth) : 0;
        const dashH = dashboard ? (dashboard.offsetHeight || dashboard.clientHeight || 600) : 600;

        const heatCanvas = document.getElementById('heatmapCanvas');
        if (heatCanvas) {
            const parentW = (heatCanvas.parentElement && heatCanvas.parentElement.offsetWidth) || (dashW - 185) || (window.innerWidth * 0.88);
            const parentH = (heatCanvas.parentElement && heatCanvas.parentElement.offsetHeight) || dashH;
            heatCanvas.width = Math.round(parentW * dpr);
            heatCanvas.height = Math.round(parentH * dpr);
            console.log(`[Heatmap] 🎯 Force-sized heatmapCanvas: ${Math.round(parentW)}x${Math.round(parentH)}`);
        }

        const domCanvas = document.getElementById('domCanvas');
        if (domCanvas) {
            const domParentW = (domCanvas.parentElement && domCanvas.parentElement.offsetWidth) || 180;
            const domParentH = (domCanvas.parentElement && domCanvas.parentElement.offsetHeight) || dashH;
            domCanvas.width = Math.round(domParentW * dpr);
            domCanvas.height = Math.round(domParentH * dpr);
        }

        const timeCanvas = document.getElementById('timeCanvas');
        if (timeCanvas) {
            const timeParentW = (timeCanvas.parentElement && timeCanvas.parentElement.offsetWidth) || (dashW - 185);
            const timeParentH = 26;
            timeCanvas.width = Math.round(timeParentW * dpr);
            timeCanvas.height = Math.round(timeParentH * dpr);
        }
    })();

    requestAnimationFrame(renderLoop);
    startWebSockets(pair); // Start live data ASAP

    // Load historical data in background (doesn't block render)
    loadInitialHistory(pair).catch(e => console.error('[Heatmap] History err:', e));
    fetchKlines(pair).catch(e => console.error('[Heatmap] Klines err:', e));
    loadTradeHistory(pair, 10000).catch(e => console.error('[Heatmap] Trade history err:', e));

    // 🧱 Start absorption zone polling every 5s
    absorptionZones = [];
    pollAbsorptionZones();
    if (absorptionZonePollInterval) clearInterval(absorptionZonePollInterval);
    absorptionZonePollInterval = setInterval(pollAbsorptionZones, 5000);

    // 🏆 Start global liquidity polling every 10s
    globalClusters = [];
    pollGlobalLiquidity();
    if (globalLiquidityPollInterval) clearInterval(globalLiquidityPollInterval);
    globalLiquidityPollInterval = setInterval(pollGlobalLiquidity, 10000);

    // 🌊 Deep Depth REST polling every 15s — balanced density vs performance
    refreshDeepDepth(pair);
    if (deepDepthInterval) clearInterval(deepDepthInterval);
    deepDepthInterval = setInterval(() => refreshDeepDepth(pair), 15000);
}

async function refreshDeepDepth(pair) {
    if (!heatmapActive || !pair) return;
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        const isStandalone = window.location.protocol === 'file:';
        const base = isStandalone ? 'http://localhost:3000' : '';
        
        let data = null;
        // In standalone mode, try Binance directly first to avoid waiting for local bot proxy
        if (isStandalone) {
            try {
                const bRes = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`);
                if (bRes.ok) data = await bRes.json();
            } catch (e) { console.warn("[Heatmap] Direct Binance fetch failed, trying local proxy..."); }
        }

        if (!data) {
            const res = await fetch(`${base}/api/liquidity/proxy-depth/${symbol}`);
            if (res.ok) data = await res.json();
        }

        if (data && data.bids) {
            const allBids = data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]);
            const allAsks = data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]);

            // 🎯 FOR HEATMAP: Keep TOP 50 levels for background noise reduction
            const topBids = [...allBids].sort((a, b) => b[1] - a[1]).slice(0, 50);
            const topAsks = [...allAsks].sort((a, b) => b[1] - a[1]).slice(0, 50);

            // 🎯 FOR DOM: Keep FULL depth so we see the spread around current price
            deepDOMData = { bids: allBids, asks: allAsks };

            // 🌊 DEEP HEAT INJECTION (Noise filtered for chart background)
            heatSnapshots.push({
                time: Date.now(),
                price: currentPrice || parseFloat(data.bids[0][0]),
                bids: topBids,
                asks: topAsks,
                isDeep: true
            });
            if (heatSnapshots.length > MAX_SNAPSHOTS) heatSnapshots.shift();

            console.log(`[Heatmap] ✅ Deep Depth Synced: Raw ${allBids.length + allAsks.length}L | Filtered ${topBids.length + topAsks.length}L for ${symbol}`);
        }
    } catch (e) { console.error('[Heatmap] ❌ Deep Depth Err:', e); }
}

function setupInteractions() {
    const canvas = document.getElementById('heatmapCanvas');
    const domCanvas = document.getElementById('domCanvas');
    const timeCanvas = document.getElementById('timeCanvas');
    if (!canvas) return;

    window.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mX = e.clientX - rect.left;
        const mY = e.clientY - rect.top;
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        
        if (e.target === canvas) {
            // TradingView Style: If click is on the right side (price scale), zoom Y
            if (mX > canvas.offsetWidth - 80) {
                dragM = 2; // Zoom Y
                document.body.style.cursor = 'ns-resize';
            } else {
                dragM = 1; // Pan
                canvas.style.cursor = 'grabbing';
            }
        } else if (e.target === domCanvas || e.target.closest('.dom-sidebar')) {
            dragM = 2; // Zoom Y
            document.body.style.cursor = 'ns-resize';
        } else if (e.target === timeCanvas || e.target.closest('#bottom-axis')) {
            dragM = 3; // Zoom X
            document.body.style.cursor = 'ew-resize';
        }
    };

    window.onmousemove = (e) => {
        if (!heatmapActive) return;

        // Hover effect for price/time scales
        const rect = canvas.getBoundingClientRect();
        const mX = e.clientX - rect.left;
        const mY = e.clientY - rect.top;

        if (!dragM) {
            if (e.target === canvas && mX > canvas.offsetWidth - 80) {
                canvas.style.cursor = 'ns-resize';
            } else if (e.target === domCanvas || (e.target && e.target.closest && e.target.closest('.dom-sidebar'))) {
                document.body.style.cursor = 'ns-resize';
                if (domCanvas) domCanvas.style.cursor = 'ns-resize';
            } else if (e.target === timeCanvas || (e.target && e.target.closest && e.target.closest('#bottom-axis'))) {
                document.body.style.cursor = 'ew-resize';
                if (timeCanvas) timeCanvas.style.cursor = 'ew-resize';
            } else if (e.target === canvas) {
                canvas.style.cursor = 'crosshair';
            } else {
                document.body.style.cursor = 'default';
                if (canvas) canvas.style.cursor = 'default';
                if (domCanvas) domCanvas.style.cursor = 'default';
            }
            return;
        }

        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        const pricePerPixel = (maxPrice - minPrice) / canvas.offsetHeight;
        const timePerPixel = TIME_WINDOW_MS / canvas.offsetWidth;

        if (dragM === 1) { // Panning
            isLive = false;
            document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);
            
            // Pan Price
            minPrice += dy * pricePerPixel;
            maxPrice += dy * pricePerPixel;
            
            // Pan Time
            timeOffset += dx * timePerPixel;
        } 
        else if (dragM === 2) { // Zoom Y
            document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);
            const zoomFactor = 1 + dy / 200;
            const midPrice = (maxPrice + minPrice) / 2;
            const newHalfRange = ((maxPrice - minPrice) * zoomFactor) / 2;
            maxPrice = midPrice + newHalfRange;
            minPrice = midPrice - newHalfRange;
        } 
        else if (dragM === 3) { // Zoom X
            isLive = false;
            const zoomFactor = 1 - dx / 200;
            TIME_WINDOW_MS = Math.max(5000, TIME_WINDOW_MS * zoomFactor);
            updateTimeZoom(TIME_WINDOW_MS / 1000);
        }

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    };

    window.onmouseup = () => {
        dragM = 0;
        canvas.style.cursor = 'crosshair';
        document.body.style.cursor = 'default';
    };

    window.onwheel = (e) => {
        if (!heatmapActive) return;
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const mX = e.clientX - rect.left;
        const mY = e.clientY - rect.top;
        const mousePrice = maxPrice - (mY / canvas.offsetHeight) * (maxPrice - minPrice);
        const timePerPixel = TIME_WINDOW_MS / canvas.offsetWidth;

        if (e.ctrlKey) {
            // Zoom Y (anchored to mouse price)
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
            const newRange = (maxPrice - minPrice) * zoomFactor;
            const ratio = mY / canvas.offsetHeight;
            maxPrice = mousePrice + ratio * newRange;
            minPrice = maxPrice - newRange;
        } 
        else if (e.shiftKey) {
            // Pan Time
            isLive = false;
            timeOffset -= e.deltaY * timePerPixel * 5;
        }
        else if (e.altKey) {
            // Pan Price
            const pricePerPixel = (maxPrice - minPrice) / canvas.offsetHeight;
            minPrice += e.deltaY * pricePerPixel;
            maxPrice += e.deltaY * pricePerPixel;
        }
        else {
            // Default: Zoom X (anchored to right-ish side for usability)
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
            TIME_WINDOW_MS = Math.max(5000, TIME_WINDOW_MS * zoomFactor);
            updateTimeZoom(TIME_WINDOW_MS / 1000);
        }
    };

    canvas.ondblclick = () => {
        isLive = true;
        timeOffset = 0;
        document.getElementById('autoScale') && (document.getElementById('autoScale').checked = true);
    };

    canvas.oncontextmenu = (e) => e.preventDefault();
}

function closeHeatmap() {
    heatmapActive = false;
    document.getElementById('heatmapModal').style.display = 'none';
    if (depthWS) depthWS.close();
    if (tradeWS) tradeWS.close();
    if (absorptionZonePollInterval) { clearInterval(absorptionZonePollInterval); absorptionZonePollInterval = null; }
    if (globalLiquidityPollInterval) { clearInterval(globalLiquidityPollInterval); globalLiquidityPollInterval = null; }
    if (deepDepthInterval) { clearInterval(deepDepthInterval); deepDepthInterval = null; }
    absorptionZones = [];
    globalClusters = [];
}

async function loadInitialHistory(pair) {
    try {
        const pairParam = pair.replace('/', '-');
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/liquidity/history/${pairParam}`);
        const data = await res.json();
        if (data.success) {
            heatSnapshots = data.snapshots.map(s => ({
                time: new Date(s.timestamp).getTime(),
                price: s.price,
                bids: (s.bids || []).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
                asks: (s.asks || []).map(a => [parseFloat(a[0]), parseFloat(a[1])])
            }));
            if (heatSnapshots.length > 0) {
                currentPrice = heatSnapshots[heatSnapshots.length - 1].price;
                if (!minPrice || minPrice === 0) {
                    minPrice = currentPrice * 0.999;
                    maxPrice = currentPrice * 1.001;
                }
            }
        }
    } catch (e) { console.error('History API error:', e); }
}

async function fetchKlines(pair) {
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        // Fetch up to 1000 1m klines for larger timeframe context
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1000`);
        const data = await res.json();
        klines = data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            delta: 0 // Initialize delta
        }));
        console.log(`📊 Loaded ${klines.length} klines for ${symbol}`);
    } catch (e) {
        console.error('Klines fetch error:', e);
    }
}

async function loadTradeHistory(pair, limit = 1000) {
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        let allTrades = [];
        let endTime = Date.now();

        // Fetch in chunks of 1000 (Binance limit)
        const fetchLimit = 1000;
        const totalToFetch = Math.min(limit, 5000); // Caps at 5000 for performance

        for (let i = 0; i < Math.ceil(totalToFetch / fetchLimit); i++) {
            let url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=${fetchLimit}&endTime=${endTime}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;

            allTrades = [...data, ...allTrades];
            // Update endTime to the oldest trade in this batch to fetch previous trades
            endTime = data[0].T - 1;
            if (allTrades.length >= totalToFetch) break;
        }

        let aggregated = []; currentCVD = 0; cvdData = [];
        allTrades.forEach(t => {
            currentCVD += t.m ? -parseFloat(t.q) : parseFloat(t.q);
            cvdData.push({ time: t.T, value: currentCVD });
            const timeBin = Math.floor(t.T / 100) * 100;
            const last = aggregated[aggregated.length - 1];
            if (last && last.time === timeBin) {
                if (t.m) last.sellQty += parseFloat(t.q); else last.buyQty += parseFloat(t.q);
                last.price = (last.price + parseFloat(t.p)) / 2;
            } else {
                aggregated.push({ time: timeBin, price: parseFloat(t.p), buyQty: t.m ? 0 : parseFloat(t.q), sellQty: t.m ? parseFloat(t.q) : 0 });
            }
        });

        // Merge with existing tradeBubbles to keep history when zooming
        const existingMap = new Map(tradeBubbles.map(b => [b.time, b]));
        aggregated.forEach(b => {
            existingMap.set(b.time, b);
        });

        tradeBubbles = Array.from(existingMap.values()).sort((a, b) => a.time - b.time);
        if (tradeBubbles.length > MAX_BUBBLES) tradeBubbles = tradeBubbles.slice(-MAX_BUBBLES);

        // Pre-calculate candle deltas
        calculateCandleDeltas();

    } catch (e) { console.error('Trade history error:', e); }
}

function calculateCandleDeltas() {
    if (klines.length === 0 || tradeBubbles.length === 0) return;

    let tradeIdx = 0;
    klines.forEach(k => {
        const startTime = k.time;
        const endTime = k.time + 60000;
        k.delta = 0;
        
        // Fast-forward to start
        while (tradeIdx < tradeBubbles.length && tradeBubbles[tradeIdx].time < startTime) {
            tradeIdx++;
        }
        
        // Sum within window
        let i = tradeIdx;
        while (i < tradeBubbles.length && tradeBubbles[i].time < endTime) {
            k.delta += (tradeBubbles[i].buyQty - tradeBubbles[i].sellQty);
            i++;
        }
    });
}

function startWebSockets(pair) {
    const symbol = pair.replace('/', '').toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${symbol}@depth50@100ms`;
    console.log(`[Heatmap] 🔌 Connecting Depth WS: ${wsUrl}`);
    depthWS = new WebSocket(wsUrl);
    
    depthWS.onopen = () => console.log(`[Heatmap] ✅ Depth WS Connected`);
    depthWS.onerror = (e) => console.error(`[Heatmap] ❌ Depth WS Error:`, e);

    depthWS.onmessage = (event) => {
        if (!heatmapActive) return;
        const data = JSON.parse(event.data);
        heatSnapshots.push({
            time: Date.now(), price: currentPrice || parseFloat(data.b[0][0]),
            bids: data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]), asks: data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])])
        });
        lastDOMData = { bids: data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]), asks: data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])]) };
        if (heatSnapshots.length > MAX_SNAPSHOTS) heatSnapshots.shift();
    };

    const tradeWsUrl = `wss://fstream.binance.com/ws/${symbol}@aggTrade`;
    console.log(`[Heatmap] 🔌 Connecting Trade WS: ${tradeWsUrl}`);
    tradeWS = new WebSocket(tradeWsUrl);
    
    tradeWS.onopen = () => console.log(`[Heatmap] ✅ Trade WS Connected`);
    tradeWS.onerror = (e) => console.error(`[Heatmap] ❌ Trade WS Error:`, e);

    tradeWS.onmessage = (event) => {
        if (!heatmapActive) return;
        const data = JSON.parse(event.data); currentPrice = parseFloat(data.p);
        const delta = data.m ? -parseFloat(data.q) : parseFloat(data.q);
        const qty = parseFloat(data.q);

        // 🐋 WHALE SOUND TRIGGER
        if (document.getElementById('whaleSound')?.checked && qty * currentPrice > 10000) { // $10k+ trade
            initAudio();
            playSynthSound(150, 'triangle', 0.3, 0.1); // Deep thump for big trades
        }

        currentCVD += delta; cvdData.push({ time: Date.now(), value: currentCVD });
        tradeCounter++; if (cvdData.length > MAX_CVD) cvdData.shift();
        const timeBin = Math.floor(Date.now() / 100) * 100;
        const last = tradeBubbles[tradeBubbles.length - 1];
        if (last && last.time === timeBin) {
            if (data.m) last.sellQty += parseFloat(data.q); else last.buyQty += parseFloat(data.q);
            last.price = (last.price + currentPrice) / 2;
        } else {
            tradeBubbles.push({ time: timeBin, price: currentPrice, buyQty: data.m ? 0 : parseFloat(data.q), sellQty: data.m ? parseFloat(data.q) : 0 });
        }
        if (tradeBubbles.length > MAX_BUBBLES) tradeBubbles.shift();

        // ⚡ REAL-TIME DOM HIT (Sidebar Pulse)
        const currentTick = heatmapPair.includes('BTC') ? (maxPrice - minPrice > 500 ? 10 : 5) : 1.0; 
        const hitBin = Math.round(currentPrice / currentTick) * currentTick;
        if (!domHeatHits[hitBin]) domHeatHits[hitBin] = { qty: 0, time: 0 };
        domHeatHits[hitBin].qty += qty;
        domHeatHits[hitBin].time = Date.now();

        // 🕯️ LIVE CANDLE LOGIC (OHLC Management)
        const candleTime = Math.floor(Date.now() / 60000) * 60000;
        let lastCandle = klines[klines.length - 1];
        if (!lastCandle || lastCandle.time !== candleTime) {
            klines.push({
                time: candleTime,
                open: currentPrice,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
                delta: delta // Start new candle with current trade delta
            });
            if (klines.length > MAX_KLINES) klines.shift();
        } else {
            lastCandle.high = Math.max(lastCandle.high, currentPrice);
            lastCandle.low = Math.min(lastCandle.low, currentPrice);
            lastCandle.close = currentPrice;
            lastCandle.delta += delta; // Accumulate delta
        }
    };

    setInterval(() => {
        if (!heatmapActive) return;
        const now = Date.now(); currentTPS = (tradeCounter / (now - lastTPSUpdate)) * 1000;
        tradeCounter = 0; lastTPSUpdate = now;
        
        // Cleanup old DOM hits
        Object.keys(domHeatHits).forEach(k => {
            if (domHeatHits[k].time < now - 2000) delete domHeatHits[k];
        });
    }, 1000);
}

const binarySearchIndex = (arr, target, key = 'time') => {
    let low = 0, high = arr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (arr[mid][key] < target) low = mid + 1;
        else if (arr[mid][key] > target) high = mid - 1;
        else return mid;
    }
    return low;
};

function updateStandardizedTickSize() {
    if (isAutoTick) {
        calculateAutoTick();
    }
}

function renderLoop(time) {
    if (!heatmapActive) return;
    try {
        if (time - lastRenderTime > 24) { 
            updateStandardizedTickSize();
            drawMainChart(); 
            drawTimeAxis();
            lastRenderTime = time; 
        }
    } catch (e) {
        console.error(e);
        const canvas = document.getElementById('heatmapCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.fillRect(0, 0, canvas.width, 100);
            ctx.fillStyle = 'white';
            ctx.font = '16px monospace';
            ctx.fillText(e.toString() + ' | Stack: ' + e.stack.substring(0, 100), 10, 50);
        }
    }
    requestAnimationFrame(renderLoop);
}

function drawMainChart() {
    const canvas = document.getElementById('heatmapCanvas'); if (!canvas) return;

    // 🔑 Critical fix: Use backing store size, NOT offsetWidth (which can be 0 during layout)
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width / dpr;
    let h = canvas.height / dpr;

    // Auto-resize from parent if canvas was never sized
    if (w < 10 || h < 10) {
        const parent = canvas.parentElement;
        if (parent && parent.clientWidth > 10) {
            canvas.width = parent.clientWidth * dpr;
            canvas.height = parent.clientHeight * dpr;
            w = parent.clientWidth;
            h = parent.clientHeight;
        } else {
            return; // Parent is also 0, nothing we can do
        }
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010306'; ctx.fillRect(0, 0, w, h);

    // Show loading state if no data yet
    if (heatSnapshots.length < 2 && tradeBubbles.length < 2) {
        ctx.fillStyle = '#1a2a3a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚡ BOOKMAP LIVE — Connecting...`, w / 2, h / 2 - 20);
        ctx.fillStyle = '#888';
        ctx.font = '12px monospace';
        ctx.fillText(`Canvas: ${Math.round(w)}×${Math.round(h)} | Snapshots: ${heatSnapshots.length} | Bubbles: ${tradeBubbles.length}`, w / 2, h / 2 + 10);
        ctx.fillText(`Price: ${currentPrice || 'Waiting...'}`, w / 2, h / 2 + 30);
        return;
    }

    // 🔑 Seed currentPrice from history data if WebSocket hasn't fired yet
    if (!currentPrice || currentPrice === 0) {
        if (tradeBubbles.length > 0) {
            currentPrice = tradeBubbles[tradeBubbles.length - 1].price;
        } else if (heatSnapshots.length > 0) {
            currentPrice = heatSnapshots[heatSnapshots.length - 1].price;
        }
    }

    if (document.getElementById('autoScale')?.checked) {
        if (currentPrice > 0) {
            // Always center on currentPrice. Use ±1% as default view window.
            let localMin = currentPrice * 0.995;
            let localMax = currentPrice * 1.005;

            // Expand range to include nearby snapshots (within 2% of price)
            const twoPercent = currentPrice * 0.02;
            const snapLimit = Math.max(0, heatSnapshots.length - 2000);
            for (let i = heatSnapshots.length - 1; i >= snapLimit; i--) {
                const s = heatSnapshots[i];
                if (s.price > 0 && Math.abs(s.price - currentPrice) < twoPercent) {
                    localMin = Math.min(localMin, s.price);
                    localMax = Math.max(localMax, s.price);
                }
            }

            // Expand range to include recent trade bubbles (within 2% of price)  
            const bubbleLimit = Math.max(0, tradeBubbles.length - 500);
            for (let i = tradeBubbles.length - 1; i >= bubbleLimit; i--) {
                const b = tradeBubbles[i];
                if (b.price > 0 && Math.abs(b.price - currentPrice) < twoPercent) {
                    localMin = Math.min(localMin, b.price);
                    localMax = Math.max(localMax, b.price);
                }
            }

            const range = (localMax - localMin) * (1 / priceZoom);

            // Add 15% padding on each side for context
            minPrice = localMin - range * 0.15;
            maxPrice = localMax + range * 0.15;

            // Final safety: currentPrice MUST be inside [minPrice, maxPrice]
            if (currentPrice < minPrice) minPrice = currentPrice * 0.998;
            if (currentPrice > maxPrice) maxPrice = currentPrice * 1.002;
        }
    }

    // Safety guard: if price range is still 0 or invalid, use simple ±1% window
    if (!minPrice || !maxPrice || maxPrice <= minPrice || !currentPrice || isNaN(minPrice) || isNaN(maxPrice)) {
        if (currentPrice > 0) {
            minPrice = currentPrice * 0.990;
            maxPrice = currentPrice * 1.010;
        } else {
            ctx.fillStyle = '#ff6b35';
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(`Waiting for valid price data...`, w / 2, h / 2);
            // Default to 0,1 to prevent tickSize exploding
            minPrice = 0; maxPrice = 1; 
            return;
        }
    }

    // 🕰️ TIME SYNC CHECK (Server snapshots might be slightly off from browser clock)
    if (heatSnapshots.length > 0 && isLive) {
        const lastSnapTime = heatSnapshots[heatSnapshots.length - 1].time;
        const timeDiff = Date.now() - lastSnapTime;
        // If history is way behind or ahead (e.g. > 10m), we need to align the window
        if (Math.abs(timeDiff) > 600000) {
            console.warn(`[Heatmap] 🕰️ Time desync detected (${Math.round(timeDiff/1000)}s). Aligning...`);
        }
    }

    const now = Date.now();
    const endTimeVisible = isLive ? now : (now + timeOffset);
    const startTimeVisible = endTimeVisible - TIME_WINDOW_MS;

    // Sync timeOffset back to 0 if "Live" is forced
    if (isLive) timeOffset = 0;

    const getX = (t) => ((t - startTimeVisible) / TIME_WINDOW_MS) * w;
    const getY = (p) => h - ((p - minPrice) / (maxPrice - minPrice) * h);

    const startIdx = binarySearchIndex(heatSnapshots, startTimeVisible - 5000);
    const visibleSnaps = heatSnapshots.slice(startIdx);

    // 🔬 STABILIZED NORMALIZATION — Throttled O(N) calculation to prevent lag
    let globalMaxQty = cachedGlobalMaxQty;
    
    if (now - lastGlobalMaxUpdate > 500) {
        let totalQtySum = 0;
        let qtyCount = 0;
        
        visibleSnaps.forEach(s => {
            s.asks.forEach(l => { if (l[1] > 0) { totalQtySum += l[1]; qtyCount++; } });
            s.bids.forEach(l => { if (l[1] > 0) { totalQtySum += l[1]; qtyCount++; } });
        });
        
        if (qtyCount > 0) {
            let meanQty = totalQtySum / qtyCount;
            cachedGlobalMaxQty = Math.max(1, meanQty * 4);
            globalMaxQty = cachedGlobalMaxQty;
        }
        lastGlobalMaxUpdate = now;
    }

    // 🧱 INSTITUTIONAL SINGLE-CANVAS ENGINE (Chart + DOM Sidebar sync)
    const domWidth = 180;
    const chartWidth = w - domWidth;
    
    // 1. Draw Sidebar Background
    ctx.fillStyle = '#060a12';
    ctx.fillRect(chartWidth, 0, domWidth, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(chartWidth, 0); ctx.lineTo(chartWidth, h); ctx.stroke();

    const heatToggle = document.getElementById('showHeat');
    if (heatToggle && heatToggle.checked) {
        const binned = getBinnedDOM(minPrice, maxPrice, tickSize);
        const domLevels = Object.keys(binned).map(p => ({ 
            p: parseFloat(p), 
            q: binned[p].q, 
            isAsk: binned[p].isAsk 
        }));

        let maxDOMQty = 1;
        domLevels.forEach(l => { if (l.q > maxDOMQty) maxDOMQty = l.q; });

        const filterThreshold = 0.35 + (heatSensitivity * 0.45);

        domLevels.forEach(l => {
            if (l.p < minPrice || l.p > maxPrice) return;
            
            const rawIntensity = l.q / maxDOMQty;
            const intensity = Math.pow(Math.min(1, rawIntensity), 2.2);
            if (intensity < filterThreshold) return;

            const y = getY(l.p);
            const color = l.isAsk ? '#ff3366' : '#00ffff';
            
            // --- 🔬 INSTITUTIONAL GLOW INDICATOR (Ported from Footprint) ---
            
            // A. CAST LIGHTING: Project a soft atmospheric bar across the chart
            ctx.fillStyle = l.isAsk ? 'rgba(255, 51, 102, 0.08)' : 'rgba(0, 255, 255, 0.08)';
            ctx.fillRect(0, y - 5, chartWidth, 10);

            // B. HORIZONTAL LIQUIDITY WALL
            const wallAlpha = Math.min(0.8, 0.2 + (intensity * 0.6));
            ctx.fillStyle = l.isAsk ? `rgba(255, 51, 102, ${wallAlpha})` : `rgba(0, 255, 255, ${wallAlpha})`;
            const wallH = Math.max(2, Math.min(8, intensity * 15));
            ctx.fillRect(0, y - wallH / 2, chartWidth, wallH);

            // C. ELITE GLOW CORE (Solid Center)
            if (intensity > 0.8) {
                ctx.fillStyle = color;
                ctx.fillRect(0, y - 1, chartWidth, 2);
            }

            // D. SIDEBAR VOLUME BAR (Right side of canvas)
            // Use Math.sqrt scaling for better relative visibility
            const barMaxW = domWidth - 70;
            const barW = (Math.sqrt(l.q) / Math.sqrt(maxDOMQty)) * barMaxW;
            const barX = (w - 60) - barW;
            
            if (intensity > 0.7) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
            }
            
            ctx.fillStyle = color;
            ctx.fillRect(barX, y - 4, barW, 8);
            ctx.shadowBlur = 0;

            // E. NUMERICAL LABELS
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right';
            const qtyStr = l.q >= 1000 ? (l.q/1000).toFixed(1)+'K' : Math.round(l.q).toString();
            ctx.fillText(qtyStr, w - 10, y + 4);
        });
    }

    // 📊 SHARED CALC DATA (Pre-filtered for speed)
    const bubbleStartIdx = binarySearchIndex(tradeBubbles, startTimeVisible - 600000); // Back 10m for calculations
    const calcTrades = tradeBubbles.slice(bubbleStartIdx);

    // 📊 VOLUME HISTOGRAM / VWAP (Optimized single-pass)
    const volH = h * 0.15; 
    const histBins = {};
    let maxBinVol = 0;
    let cumPV = 0; 
    let cumV = 0;
    const vwapPoints = [];
    const priceBins = {};

    calcTrades.forEach(t => {
        const x = getX(t.time);
        const q = t.buyQty + t.sellQty;
        
        // VWAP (10m lookback)
        cumPV += t.price * q;
        cumV += q;
        if (x >= 0 && x <= w) {
            vwapPoints.push({ time: t.time, value: cumPV / cumV });
            
            // Volume Histogram
            const binIdx = Math.floor(x / 6); 
            if (!histBins[binIdx]) histBins[binIdx] = { buy: 0, sell: 0 };
            histBins[binIdx].buy += t.buyQty; 
            histBins[binIdx].sell += t.sellQty;
            maxBinVol = Math.max(maxBinVol, histBins[binIdx].buy + histBins[binIdx].sell);

            // POC (Visible only)
            const pBin = Math.round(t.price * 10) / 10;
            priceBins[pBin] = (priceBins[pBin] || 0) + q;
        }
    });

    // Drawing VWAP
    if (document.getElementById('showVWAP')?.checked && vwapPoints.length > 2) {
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.beginPath();
        vwapPoints.forEach((p, i) => {
            const x = getX(p.time); const y = getY(p.value);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 10px Inter'; ctx.fillText('VWAP', 10, getY(vwapPoints[vwapPoints.length - 1].value) - 10);
    }

    // Drawing Volume Histogram
    Object.keys(histBins).forEach(binX => {
        const x = binX * 6; const data = histBins[binX]; const total = data.buy + data.sell;
        const barH = Math.min(volH, (total / maxBinVol) * volH);
        ctx.fillStyle = 'rgba(0, 255, 120, 0.7)'; ctx.fillRect(x, h - (data.buy / total) * barH, 5, (data.buy / total) * barH);
        ctx.fillStyle = 'rgba(255, 40, 40, 0.7)'; ctx.fillRect(x, h - barH, 5, (data.sell / total) * barH);
    });

    // 📊 DELTA BARS (Net Flow)
    if (document.getElementById('showDeltaBars')?.checked) {
        const deltaH = h * 0.08;
        Object.keys(histBins).forEach(binX => {
            const x = binX * 6; const data = histBins[binX]; const netDelta = data.buy - data.sell;
            const barH = Math.min(deltaH, (Math.abs(netDelta) / maxBinVol) * deltaH * 2);
            ctx.fillStyle = netDelta > 0 ? 'rgba(0, 255, 120, 0.9)' : 'rgba(255, 40, 40, 0.9)';
            const yStart = h - volH - 10;
            if (netDelta > 0) ctx.fillRect(x, yStart - barH, 5, barH);
            else ctx.fillRect(x, yStart, 5, barH);
        });
        ctx.fillStyle = '#10b981'; ctx.font = 'bold 9px Inter'; ctx.fillText('NET DELTA', 10, h - volH - 25);
    }

    // 🎯 POC (Point of Control)
    if (document.getElementById('showPOC')?.checked) {
        let maxVol = 0; let pocPrice = 0;
        Object.keys(priceBins).forEach(p => { if (priceBins[p] > maxVol) { maxVol = priceBins[p]; pocPrice = parseFloat(p); } });

        if (pocPrice > 0) {
            const y = getY(pocPrice);
            ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 2; ctx.setLineDash([10, 5]);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartWidth, y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#8b5cf6'; ctx.font = 'bold 11px Inter'; ctx.fillText(`POC: $${pocPrice}`, chartWidth - 85, y - 5);
        }
    }

    // ⚡ IMBALANCE MARKERS
    if (document.getElementById('showImbalance')?.checked) {
        tradeBubbles.forEach(t => {
            const x = getX(t.time); if (x < 0 || x > w) return;
            const ratio = t.buyQty > t.sellQty ? t.buyQty / Math.max(0.1, t.sellQty) : t.sellQty / Math.max(0.1, t.buyQty);
            if (ratio > 4 && (t.buyQty + t.sellQty) > maxBinVol * 0.1) { // 4x Imbalance + significant volume
                const y = getY(t.price);
                ctx.fillStyle = t.buyQty > t.sellQty ? '#00ffaa' : '#ff3366';
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
                // Add mini glow
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
            }
        });
    }

    // 🔵 TRADES (ADAPTIVE BUBBLES - highly optimized for extreme FPS)
    if (document.getElementById('showBubbles')?.checked) {
        const bubbleStartIdx = binarySearchIndex(tradeBubbles, startTimeVisible - 1000);
        
        // Zero-allocation visible slice filtering
        const visibleTrades = [];
        const rightEdgeLimit = chartWidth + 50;
        let maxVol = 1;
        let totalVolSum = 0;

        for (let i = bubbleStartIdx; i < tradeBubbles.length; i++) {
            const t = tradeBubbles[i];
            if (getX(t.time) > rightEdgeLimit) continue; // Out of bounds right
            if (t.time > endTimeVisible + 5000) break; // Optimization exit
            
            const totalQty = t.buyQty + t.sellQty;
            if (totalQty > maxVol) maxVol = totalQty;
            totalVolSum += totalQty;
            visibleTrades.push(t);
        }

        const avgVol = visibleTrades.length > 0 ? totalVolSum / visibleTrades.length : 1;

        // 🔄 Draw Trades (Skip expensive sort to prevent UI freeze on large datasets)
        // Opacity naturally layers new trades over old ones, improving tape readability automatically.
        visibleTrades.forEach(t => {
            const x = getX(t.time);
            if (x > chartWidth || x < -50) return; // Boundary clip for sidebar alignment
            const y = getY(t.price);
            const totalQty = t.buyQty + t.sellQty;
            
            // Noise reduction: Skip drawing micro-bubbles if they are insignificant relative to screen max
            if (maxVol > 10 && totalQty < maxVol * 0.02) return; 

            const delta = t.buyQty - t.sellQty;

            // 💡 STRICT MAX SCALING: The largest bubble on screen gets baseFactor = 1.0
            const baseFactor = Math.sqrt(totalQty / maxVol);
            let radius = baseFactor * (35 * bubbleScale); // Adjusted back to large professional Bookmap size

            // Prevent insanely small or large bubbles
            radius = Math.min(90, Math.max(1.5, radius));

            // ⚡ PERFORMANCE & CLUTTER FIX: Draw noise as simple dots
            if (radius < 3 && totalQty < maxVol * 0.1) {
                ctx.fillStyle = delta >= 0 ? '#00ff88' : '#ff3366';
                ctx.fillRect(x - 1, y - 1, 2, 2);
                return;
            }

            ctx.save();
            ctx.globalAlpha = 0.95; // 3D solid look

            const buyRatio = t.buyQty / totalQty;
            const startAngle = -Math.PI / 2;
            const buyEndAngle = startAngle + (Math.PI * 2 * buyRatio);

            // 1. Base colors (Vivid)
            if (buyRatio > 0) {
                ctx.fillStyle = '#00ff88'; 
                ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, radius, startAngle, buyEndAngle); ctx.closePath(); ctx.fill();
            }
            if (buyRatio < 1) {
                ctx.fillStyle = '#ff3b3b'; 
                ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, radius, buyEndAngle, startAngle + Math.PI * 2); ctx.closePath(); ctx.fill();
            }

            // 2. 3D Gloss Effect (Cached)
            ctx.globalCompositeOperation = 'source-atop';
            ctx.drawImage(bubbleGlossCanvas, x - radius, y - radius, radius * 2, radius * 2);
            ctx.globalCompositeOperation = 'source-over';

            // 3. Separation Outline
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = radius > 15 ? 1 : 0.5;
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();

            // 4. Delta Text
            if (radius > 16) {
                const fontSize = Math.max(9, Math.min(13, radius / 2.2));
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${fontSize}px Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.lineJoin = 'round';

                const deltaTxt = (delta > 0 ? '+' : '') + (Math.abs(delta) >= 1000 ? (delta / 1000).toFixed(1) + 'k' : delta.toFixed(0));
                ctx.strokeText(deltaTxt, x, y);
                ctx.fillText(deltaTxt, x, y);
            }
            ctx.restore();
        });
    }

    // 🧱 ABSORPTION ZONES OVERLAY
    if (absorptionZones.length > 0) {
        absorptionZones.forEach(zone => {
            const y = getY(zone.price);
            if (y < 0 || y > h) return;

            const isBuy = zone.side === 'BUY';
            const isFresh = zone.ageSeconds < 30;
            const pulse = isFresh ? (0.6 + 0.4 * Math.sin(Date.now() / 200)) : 0.7;

            ctx.save();
            ctx.globalAlpha = pulse;

            // Dashed horizontal line
            ctx.strokeStyle = isBuy ? '#00ff88' : '#ff3366';
            ctx.lineWidth = isFresh ? 2 : 1.5;
            ctx.setLineDash([8, 4]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            const label = isBuy ? '↑ ABS' : '↓ ABS';
            ctx.fillStyle = isBuy ? '#00ff88' : '#ff3366';
            ctx.font = `bold 9px Inter`;
            ctx.textAlign = 'right';
            ctx.fillText(`${label} ${zone.strength.toFixed(1)}x`, chartWidth - 10, y + 4);

            ctx.restore();
        });
    }

    /* 🏆 INSTITUTIONAL WALLS (GOLDEN FRAMES) - REMOVED FOR CLEAN UI
    if (globalClusters.length > 0) {
        globalClusters.filter(c => ['FORTRESS', 'AAA', 'AA'].includes(c.rating)).forEach(cluster => {
            const y = getY(cluster.price);
            if (y < 0 || y > h) return;

            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#f59e0b';

            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = cluster.rating === 'FORTRESS' ? 4 : (cluster.rating === 'AAA' ? 3 : 2);
            ctx.setLineDash([12, 6]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w - 110, y);
            ctx.stroke();
            ctx.setLineDash([]);

            const ratingColor = { 'FORTRESS': '#ff00ff', 'AAA': '#f59e0b', 'AA': '#fbbf24' }[cluster.rating] || '#fff';
            const label = `🏆 ${cluster.rating} WALL (${cluster.exchanges.length} EXCH)`;
            const qtyLabel = `${Math.round(cluster.totalQty).toLocaleString()} ${heatmapPair.split('/')[0]}`;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(w - 105, y - 12, 100, 24);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
            ctx.strokeRect(w - 105, y - 12, 100, 24);

            ctx.fillStyle = ratingColor;
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(label, w - 100, y - 2);

            ctx.fillStyle = '#ffffff';
            ctx.font = '8px monospace';
            ctx.fillText(qtyLabel, w - 100, y + 8);

            ctx.restore();
        });
    }
    */

    // ⚡ TAPE SPEED METER
    const tpsX = w - 100; const tpsY = 40; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(tpsX - 10, tpsY - 20, 100, 40);
    ctx.fillStyle = currentTPS > 50 ? '#ff00ff' : '#00ffdd'; ctx.font = 'bold 12px Inter'; ctx.textAlign = 'left';
    ctx.fillText(`TPS: ${Math.round(currentTPS)}`, tpsX, tpsY);
    if (currentTPS > 80) { ctx.fillStyle = '#ff00ff'; ctx.font = 'bold 10px Inter'; ctx.fillText('🔥 FAST TAPE', tpsX, tpsY + 15); }

    // 🏷️ Y-AXIS PRICE LABELS (Vivid Professional Scale)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    const tickCount = 12;
    const priceStep = (maxPrice - minPrice) / tickCount;
    for (let i = 0; i <= tickCount; i++) {
        const p = minPrice + i * priceStep;
        const y = getY(p);
        if (y >= 10 && y <= h - 10) {
            ctx.fillText(p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), w - 10, y + 4);
            // Subtle horizontal grid line
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(0, y, w - 60, 1);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        }
    }
    ctx.restore();

    // ⚪ PRICE LINE (Restored Cyan Style)
    if (currentPrice > 0) {
        const py = getY(currentPrice);
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w - 60, py);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price Badge on Axis
        ctx.fillStyle = '#00ffff';
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        const badgeH = 18;
        ctx.roundRect(w - 55, py - badgeH/2, 50, badgeH, 4);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(currentPrice.toFixed(2), w - 30, py + 4);
    }

    // 🕯️ CANDLESTICK RENDERING
    if (document.getElementById('showCandles')?.checked && klines.length > 0) {
        const candleWidth = (60000 / TIME_WINDOW_MS) * w * 0.8;
        klines.forEach(k => {
            const x = getX(k.time + 30000); // Center candle on its 1m minute
            if (x < -50 || x > w + 50) return;

            const yo = getY(k.open);
            const yh = getY(k.high);
            const yl = getY(k.low);
            const yc = getY(k.close);
            const color = k.close >= k.open ? '#10b981' : '#ef4444';

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yh);
            ctx.lineTo(x, yl);
            ctx.stroke();

            // Body
            ctx.save();
            ctx.globalAlpha = 0.8; // 🕯️ Restored solid look
            ctx.fillStyle = color;
            const bodyH = Math.max(1, Math.abs(yc - yo));
            ctx.fillRect(x - candleWidth / 2, Math.min(yo, yc), candleWidth, bodyH);
            ctx.restore();

            // 🏷️ DELTA BADGE RENDERING
            const deltaVal = Math.round(k.delta || 0);
            if (deltaVal !== 0 || isLive) {
                const badgeW = Math.max(34, candleWidth); // Scale with candle zoom so they don't overlap as easily
                const badgeH = 16;
                const gap = 12; // Gap between candle and badge
                
                // Position badge above wick for green candles, or below for red candles to avoid overlap
                const isGreen = k.close >= k.open;
                const badgeY = isGreen ? yh - gap - badgeH : yl + gap; 

                // Connecting Line
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, isGreen ? yh : yl);
                ctx.lineTo(x, isGreen ? badgeY + badgeH : badgeY);
                ctx.stroke();

                // Round Rect Box
                ctx.fillStyle = deltaVal >= 0 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
                ctx.strokeStyle = deltaVal >= 0 ? '#10b981' : '#ef4444';
                ctx.lineWidth = Math.abs(deltaVal) > 500 ? 2 : 1;

                if (Math.abs(deltaVal) > 1000) {
                    ctx.shadowColor = deltaVal >= 0 ? '#10b981' : '#ef4444';
                    ctx.shadowBlur = 10;
                }

                const bx = x - badgeW / 2;
                const by = badgeY;

                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 4);
                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Delta Text
                ctx.fillStyle = '#ffffff'; // White for better contrast on colored background
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                let txt = Math.abs(deltaVal) >= 1000 ? (deltaVal / 1000).toFixed(1) + 'k' : deltaVal.toString();
                if (deltaVal > 0) txt = '+' + txt;
                ctx.fillText(txt, x, by + badgeH / 2);
            }
        });
    }

    // 📊 DELTA INTENSITY BARS (BOTTOM OVERLAY)
    if (document.getElementById('showDeltaBars')?.checked && klines.length > 0) {
        const barAreaH = 60;
        const barMaxWeight = 2000; // Threshold for max height
        const barW = (60000 / TIME_WINDOW_MS) * w * 0.7;

        klines.forEach(k => {
            const x = getX(k.time + 30000);
            if (x < 0 || x > w) return;

            const delta = k.delta || 0;
            const barH = (Math.min(Math.abs(delta), barMaxWeight) / barMaxWeight) * barAreaH;
            const color = delta >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)';

            ctx.fillStyle = color;
            ctx.fillRect(x - barW / 2, h - barH - 5, barW, barH);
            
            // Subtle top highlight for the bars
            ctx.fillStyle = delta >= 0 ? '#10b981' : '#ef4444';
            ctx.fillRect(x - barW / 2, h - barH - 5, barW, 2);
        });
    }
}

// 🗑️ drawDOM function removed - Integrated into drawMainChart for pixel-perfect single-canvas alignment.

function drawTimeAxis() {
    const canvas = document.getElementById('timeCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, w, h);

    const endTimeVisible = Date.now() + timeOffset;
    const startTimeVisible = endTimeVisible - TIME_WINDOW_MS;
    const getX = (t) => ((t - startTimeVisible) / TIME_WINDOW_MS) * w;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    const intervalMs = TIME_WINDOW_MS / 6;
    for (let t = Math.ceil(startTimeVisible / intervalMs) * intervalMs; t <= endTimeVisible; t += intervalMs) {
        const x = getX(t);
        const date = new Date(t);
        const timeStr = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        ctx.fillText(timeStr, x, h / 2 + 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 5);
        ctx.stroke();
    }
}
