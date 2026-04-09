// API Client
const API = {
    base: window.location.protocol === 'file:' ? 'http://localhost:3000' : '',

    async get(url) {
        const res = await fetch(`${this.base}${url}`);
        return res.json();
    },

    async put(url, data) {
        const res = await fetch(`${this.base}${url}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async post(url, data = {}) {
        const res = await fetch(`${this.base}${url}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    // Settings
    getSettings: () => API.get('/api/settings'),
    updateSettings: (data) => API.put('/api/settings', data),

    // Trades
    getTrades: (params = '') => API.get(`/api/trades?${params}`),
    getStats: () => API.get('/api/trades/stats'),
    getScalpSignals: () => API.get('/api/trades/scalps'),

    // Bot
    getBotStatus: () => API.get('/api/bot/status'),
    triggerBot: () => API.post('/api/bot/trigger'),
    triggerScalpPipeline: () => API.post('/api/bot/scalp/trigger'),
    toggleSignalB: () => API.post('/api/bot/signalb/toggle'),
    getLimitEntries: () => API.get('/api/bot/limitentry/list'),
    resetBot: () => API.post('/api/bot/reset'),

    // Health
    getHealth: () => API.get('/api/health')
};
