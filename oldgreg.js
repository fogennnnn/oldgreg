#!/usr/bin/env node
/**
 * ============================================================
 * chode — The Self-Healing Coding Harness
 * Free tiers. HEMO auto-provisioning. Zero lock-in.
 *
 * Routes across 8 real free-tier providers with automatic key
 * provisioning via HEMO mail. Never stops. Exponential backoff
 * retry, checkpoint recovery, and circuit breaker failover.
 *
 * Usage:
 *   node chode.js ai [prompt]             AI call with auto-fallback routing
 *   node chode.js project <spec>          Run multi-step project
 *   node chode.js scan                    Probe all free-tier providers
 *   node chode.js score                   Show live leaderboard
 *   node chode.js status                  Full health dashboard
 *   node chode.js provision               Auto-request free-tier keys via HEMO
 *   node chode.js auth                    Set or rotate API keys
 *   node chode.js models                  List all providers
 *   node chode.js heal                    Force full re-scan
 *   node chode.js monitor                 Background health monitoring
 *   node chode.js session [list|show|reset] Manage sessions
 *   node chode.js new <name>              Scaffold a Cloudflare Worker
 *   node chode.js deps [check|install]    Manage dependencies
 *   node chode.js init                    One-time setup
 *   node chode.js help
 * ============================================================
 */

'use strict';

const { execSync, spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Paths ─────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, '.chode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSION_DIR = path.join(CONFIG_DIR, 'sessions');
const MONITOR_DIR = path.join(CONFIG_DIR, 'monitor');
const LEADERBOARD_FILE = path.join(MONITOR_DIR, 'leaderboard.json');
const CHECKPOINT_FILE = path.join(CONFIG_DIR, 'checkpoint.json');
const PROVIDER_REGISTRY_FILE = path.join(MONITOR_DIR, 'registry.json');
const USAGE_FILE = path.join(MONITOR_DIR, 'usage.json');
const AFK_TIMEOUT = 90;
const HEALTH_INTERVAL = 30000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120000;
const PARALLEL_PROVIDERS = 3;
const MAX_RETRY = 5;
const RETRY_BASE_DELAY = 1000;
const AGENTS_FILE = path.join(CONFIG_DIR, 'agents.json');
const TASKS_DIR = path.join(CONFIG_DIR, 'tasks');
const QUEUE_FILE = path.join(CONFIG_DIR, 'queue.json');
const COSTS_FILE = path.join(MONITOR_DIR, 'costs.json');
const METRICS_FILE = path.join(MONITOR_DIR, 'metrics.json');
const HEALTH_INTERVAL_MS = 30000;
const QUEUE_MAX_SIZE = 100;

// ─── Provider Registry (real free-tier endpoints only) ────────────────────────

const PROVIDERS = {

  // ── Truly free tiers (no credit card, email signup only) ──

  groq: {
    name: 'Groq',
    category: 'free_tier',
    requiresKey: 'GROQ_API_KEY',
    qualityScore: 92,
    signupUrl: 'https://console.groq.com/keys',
    freeTier: '14,400 req/day · 6K tokens/min · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  cerebras: {
    name: 'Cerebras',
    category: 'free_tier',
    requiresKey: 'CEREBRAS_API_KEY',
    qualityScore: 90,
    signupUrl: 'https://cloud.cerebras.ai/',
    freeTier: '1M tokens/day · 30 req/min · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://api.cerebras.ai/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'llama-3.1-70b', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  google: {
    name: 'Gemini (Google AI Studio)',
    category: 'free_tier',
    requiresKey: 'GEMINI_API_KEY',
    qualityScore: 94,
    signupUrl: 'https://aistudio.google.com/app/apikey',
    freeTier: '1,500 req/day · 60 req/min · No CC',
    endpoints: [{
      type: 'chat',
      url: k => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${k}`,
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (k, m) => {
        var c = m.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));
        return JSON.stringify({ contents: c, generationConfig: { maxOutputTokens: 4096 } });
      },
      parse: d => d.candidates?.[0]?.content?.parts?.[0]?.text
    }]
  },

  mistral: {
    name: 'Mistral',
    category: 'free_tier',
    requiresKey: 'MISTRAL_API_KEY',
    qualityScore: 88,
    signupUrl: 'https://console.mistral.ai/',
    freeTier: '1B tokens/month · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://api.mistral.ai/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'mistral-small', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  openrouter: {
    name: 'OpenRouter',
    category: 'free_tier',
    requiresKey: 'OPENROUTER_API_KEY',
    qualityScore: 85,
    signupUrl: 'https://openrouter.ai/keys',
    freeTier: '50 req/day free · 1K/day with $10',
    endpoints: [{
      type: 'chat',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k, 'HTTP-Referer': 'https://chode.oooooooooo.se', 'X-Title': 'chode' }),
      body: (k, m) => JSON.stringify({ model: 'free/qwen-2.5-7b-instruct', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  nvidia: {
    name: 'NVIDIA NIM',
    category: 'free_tier',
    requiresKey: 'NVIDIA_API_KEY',
    qualityScore: 86,
    signupUrl: 'https://build.nvidia.com/explore/discover',
    freeTier: '40 req/min · Phone verify · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  cloudflare: {
    name: 'Cloudflare Workers AI',
    category: 'free_tier',
    requiresKey: 'CLOUDFLARE_API_KEY',
    altKey: 'CLOUDFLARE_ACCOUNT_ID',
    qualityScore: 72,
    signupUrl: 'https://dash.cloudflare.com/sign-up/ai',
    freeTier: '10K neurons/day · No CC',
    endpoints: [{
      type: 'chat',
      url: k => `https://api.cloudflare.com/client/v4/accounts/${loadConfig().providers?.cloudflare?.accountId || ''}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      headers: k => ({ 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }),
      body: (k, m) => JSON.stringify({ messages: m }),
      parse: d => d.result?.response
    }]
  },

  deepseek: {
    name: 'DeepSeek',
    category: 'free_tier',
    requiresKey: 'DEEPSEEK_API_KEY',
    qualityScore: 89,
    signupUrl: 'https://platform.deepseek.com/',
    freeTier: 'Generous free tier · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://api.deepseek.com/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'deepseek-chat', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  cohere: {
    name: 'Cohere',
    category: 'free_tier',
    requiresKey: 'COHERE_API_KEY',
    qualityScore: 80,
    signupUrl: 'https://dashboard.cohere.com/api-keys',
    freeTier: 'Non-commercial only · No CC',
    endpoints: [{
      type: 'chat',
      url: 'https://api.cohere.com/v1/chat',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k, 'x-api-key': k }),
      body: (k, m) => JSON.stringify({ model: 'command-r', messages: m, max_tokens: 1000 }),
      parse: d => d.text
    }]
  },

  agnes: {
    name: 'Agnes AI (2.5 Flash)',
    category: 'free_tier',
    requiresKey: 'OLDGREG_KEY',
    qualityScore: 95,
    signupUrl: 'https://www.agnes-ai.com/',
    freeTier: 'Generous free tier · Google/GitHub login',
    endpoints: [{
      type: 'chat',
      url: 'https://apihub.agnes-ai.com/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'agnes-2.5-flash', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  ollama: {
    name: 'Ollama (Local)',
    category: 'free_local',
    requiresKey: null,
    qualityScore: 60,
    signupUrl: null,
    freeTier: 'Unlimited · Runs locally',
    endpoints: [{
      type: 'chat',
      url: () => (process.env.OLLAMA_URL || 'http://localhost:11434') + '/api/chat',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (k, m) => JSON.stringify({ model: process.env.OLLAMA_MODEL || 'qwen2.5', messages: m, stream: false }),
      parse: d => d.message?.content
    }]
  },

  // ── Bootstrap fallback (no key needed, used ONLY when all others fail) ──
  // This is intentionally low-quality — its job is to get us the first response
  // so we can bootstrap free API keys for the real providers above.

  pollinations: {
    name: 'Pollinations (Bootstrap)',
    category: 'bootstrap',
    requiresKey: null,
    qualityScore: 30,
    signupUrl: null,
    freeTier: 'No key · No limits · Shitty but works (when available)',
    endpoints: [{
      type: 'chat',
      url: 'https://text.pollinations.ai/openai/v1/chat/completions',
      headers: () => ({ 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }),
      body: (k, m) => JSON.stringify({ model: 'openai', messages: m, max_tokens: 2048 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },

  // ── Premium (for reference, requires paid key) ──

  anthropic: {
    name: 'Claude (Anthropic)',
    category: 'paid',
    requiresKey: 'ANTHROPIC_API_KEY',
    qualityScore: 100,
    signupUrl: 'https://console.anthropic.com/',
    freeTier: 'Paid only',
    endpoints: [{
      type: 'chat',
      url: 'https://api.anthropic.com/v1/messages',
      headers: k => ({ 'Content-Type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
      body: (k, m) => JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: m, max_tokens: 4096 }),
      parse: d => d.content?.[0]?.text
    }]
  },

  openai: {
    name: 'GPT-4o-mini (OpenAI)',
    category: 'paid',
    requiresKey: 'OPENAI_API_KEY',
    qualityScore: 95,
    signupUrl: 'https://platform.openai.com/api-keys',
    freeTier: 'Paid only',
    endpoints: [{
      type: 'chat',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }),
      body: (k, m) => JSON.stringify({ model: 'gpt-4o-mini', messages: m, max_tokens: 4096 }),
      parse: d => d.choices?.[0]?.message?.content
    }]
  },
};

// ─── Dependency Check ──────────────────────────────────────────────────────────

const GLOBAL_DEPS = {
  wrangler: { name: 'Wrangler', cmd: 'wrangler --version', npm: 'wrangler', required: true },
  node: { name: 'Node.js', check: function() { var v = process.version.slice(1); return compareVer(v, '18.0.0') >= 0; }, minVer: '18.0.0' },
  npm: { name: 'npm', cmd: 'npm --version', required: true },
};

// ─── Config ─────────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { providers: {}, heliosToken: null, omniroute: { port: 20128 } }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
function loadLeaderboard() {
  try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); }
  catch { return { providers: {}, ranked: [], updated: null }; }
}
function saveLeaderboard(lb) {
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(lb, null, 2), 'utf8');
}
function loadSession(id) {
  var sp = path.join(SESSION_DIR, (id || 'default') + '.json');
  try { return JSON.parse(fs.readFileSync(sp, 'utf8')); }
  catch { return { id: id || 'default', messages: [], fallbacks: [], lastProvider: null, createdAt: Date.now() }; }
}
function saveSession(s) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(path.join(SESSION_DIR, s.id + '.json'), JSON.stringify(s, null, 2), 'utf8');
}
function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); }
  catch { return null; }
}
function saveCheckpoint(cp) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2), 'utf8');
  } catch {}
}
function loadUsage() {
  try { var d = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (d.day !== new Date().toISOString().slice(0, 10)) d = { day: d.day, providers: {} };
    return d;
  } catch(e) { return { day: new Date().toISOString().slice(0, 10), providers: {} }; }
}
function saveUsage() { fs.mkdirSync(MONITOR_DIR, { recursive: true }); fs.writeFileSync(USAGE_FILE, JSON.stringify(usageStats, null, 2), 'utf8'); }

var usageStats = { day: new Date().toISOString().slice(0, 10), providers: {} };
var rateLimits = {};
var circuitBreakers = {};

// ─── Request Queue ─────────────────────────────────────────────────────────────

var requestQueue = [];
var queueProcessing = false;

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch { return { requests: [], createdAt: Date.now() }; }
}
function saveQueue(q) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2), 'utf8');
}
function enqueueRequest(request) {
  var q = loadQueue();
  if (q.requests.length >= QUEUE_MAX_SIZE) {
    warn('Queue full (' + QUEUE_MAX_SIZE + '), dropping oldest request');
    q.requests.shift();
  }
  q.requests.push({ ...request, queuedAt: Date.now() });
  saveQueue(q);
}
function dequeueRequest() {
  var q = loadQueue();
  if (q.requests.length === 0) return null;
  var req = q.requests.shift();
  saveQueue(q);
  return req;
}
function getQueueSize() {
  var q = loadQueue();
  return q.requests.length;
}

// ─── Cost Tracking ─────────────────────────────────────────────────────────────

var costTracker = { total: 0, byProvider: {}, day: new Date().toISOString().slice(0, 10) };

function loadCosts() {
  try {
    var c = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
    if (c.day !== costTracker.day) c = { total: 0, byProvider: {}, day: costTracker.day };
    return c;
  } catch { return { total: 0, byProvider: {}, day: costTracker.day }; }
}
function saveCosts(c) {
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  fs.writeFileSync(COSTS_FILE, JSON.stringify(c, null, 2), 'utf8');
}
function recordCost(provider, tokens, costPerMillion) {
  costTracker = loadCosts();
  var cost = (tokens / 1000000) * (costPerMillion || 0);
  costTracker.total += cost;
  if (!costTracker.byProvider[provider]) costTracker.byProvider[provider] = { requests: 0, tokens: 0, cost: 0 };
  costTracker.byProvider[provider].requests++;
  costTracker.byProvider[provider].tokens += tokens;
  costTracker.byProvider[provider].cost += cost;
  saveCosts(costTracker);
}
function getCostReport() {
  costTracker = loadCosts();
  return {
    day: costTracker.day,
    totalCost: costTracker.total.toFixed(4),
    providers: costTracker.byProvider
  };
}

// ─── Metrics Export ─────────────────────────────────────────────────────────────

function exportMetrics() {
  var metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    queueSize: getQueueSize(),
    costs: getCostReport(),
    providers: Object.keys(PROVIDERS).map(function(pid) {
      var s = usageStats.providers[pid] || { requests: 0, tokens: 0, errors: 0 };
      var cb = getCircuitState(pid);
      return { id: pid, requests: s.requests, tokens: s.tokens, errors: s.errors, circuitState: cb.state, failures: cb.failures };
    })
  };
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  return metrics;
}

function recordUsage(pid, tokens, latency) {
  if (!usageStats.providers[pid]) usageStats.providers[pid] = { requests: 0, tokens: 0, latencies: [], errors: 0 };
  var s = usageStats.providers[pid]; s.requests++; s.tokens += tokens || 0;
  if (latency) s.latencies.push(latency); if (s.latencies.length > 60) s.latencies = s.latencies.slice(-60);
  saveUsage();
  // Auto-track costs (free tiers = $0, paid tiers tracked if key present)
  var costMap = { groq: 0.10, anthropic: 3.00, openai: 0.15, deepseek: 0.14, agnes: 0.20 };
  var costPerMillion = costMap[pid] || 0;
  if (costPerMillion > 0) recordCost(pid, tokens || 0, costPerMillion);
}
function recordError(pid, error) {
  if (!usageStats.providers[pid]) usageStats.providers[pid] = { requests: 0, tokens: 0, latencies: [], errors: 0 };
  usageStats.providers[pid].errors++;
  if (error && error.indexOf('429') !== -1) recordRateLimit(pid);
  saveUsage();
}
function recordRateLimit(pid) {
  if (!rateLimits[pid]) rateLimits[pid] = { consecutive429: 0, lastReset: Date.now() };
  var r = rateLimits[pid]; r.consecutive429++; r.lastReset = Date.now();
  if (r.consecutive429 >= 3) warn('  Rate limit on ' + (PROVIDERS[pid]?.name || pid) + ' (' + r.consecutive429 + '/3)');
}
function resetRateLimit(pid) { if (rateLimits[pid]) { rateLimits[pid].consecutive429 = 0; } }
function getCircuitState(pid) {
  var cb = circuitBreakers[pid] || { failures: 0, lastFailure: 0, state: 'closed' };
  if (cb.state === 'open' && Date.now() - cb.lastFailure > CIRCUIT_BREAKER_COOLDOWN_MS) { cb.state = 'half-open'; cb.lastFailure = Date.now(); }
  return cb;
}
function recordFailure(pid, error) {
  var cb = circuitBreakers[pid] || { failures: 0, lastFailure: 0, state: 'closed' };
  cb.failures++; cb.lastFailure = Date.now();
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) cb.state = 'open';
  circuitBreakers[pid] = cb; recordError(pid, error);
}
function recordSuccess(pid) {
  var cb = circuitBreakers[pid] || { failures: 0, lastFailure: 0, state: 'closed' };
  cb.failures = 0; cb.state = 'closed'; circuitBreakers[pid] = cb;
}

// ─── Provider Registry (drift detection) ───────────────────────────────────────

function loadProviderRegistry() {
  try { return JSON.parse(fs.readFileSync(PROVIDER_REGISTRY_FILE, 'utf8')); }
  catch { return { endpoints: {}, updated: null }; }
}
function saveProviderRegistry(reg) {
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  fs.writeFileSync(PROVIDER_REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf8');
}
function detectDrift(providerId, newUrl) {
  var reg = loadProviderRegistry();
  var newHash = hashStr(newUrl);
  if (!reg.endpoints[providerId]) {
    reg.endpoints[providerId] = { hash: newHash, discoveredAt: new Date().toISOString(), url: newUrl };
    saveProviderRegistry(reg); return { drifted: false, noted: true };
  }
  if (reg.endpoints[providerId].hash !== newHash) {
    var oldUrl = reg.endpoints[providerId].url;
    reg.endpoints[providerId] = { hash: newHash, url: newUrl, driftedAt: new Date().toISOString(), from: oldUrl };
    saveProviderRegistry(reg); return { drifted: true, old: oldUrl, new: newUrl };
  }
  return { drifted: false };
}
function hashStr(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16);
}

// ─── Work Queue ─────────────────────────────────────────────────────────────────

function loadWorkQueue(id) {
  try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'work_queue_' + id + '.json'), 'utf8')); }
  catch(e) { return null; }
}
function saveWorkQueue(q) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, 'work_queue_' + q.id + '.json'), JSON.stringify(q, null, 2), 'utf8');
}
function listWorkQueues() {
  var queues = [];
  try {
    var files = fs.readdirSync(CONFIG_DIR);
    for (var i = 0; i < files.length; i++) {
      if (files[i].startsWith('work_queue_') && files[i].endsWith('.json')) {
        try { queues.push(JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, files[i]), 'utf8'))); } catch(e) {}
      }
    }
  } catch(e) {}
  return queues;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function compareVer(a, b) {
  var pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var ca = pa[i] || 0, cb = pb[i] || 0;
    if (ca > cb) return 1; if (ca < cb) return -1;
  }
  return 0;
}

function say(msg, color) {
  var palette = { white: '\x1b[38;5;252m', cyan: '\x1b[38;5;87m', green: '\x1b[38;5;82m',
    yellow: '\x1b[38;5;220m', red: '\x1b[38;5;203m', dim: '\x1b[38;5;240m',
    purple: '\x1b[38;5;141m', bright: '\x1b[38;5;195m' };
  process.stdout.write((palette[color] || palette.white) + msg + '\x1b[0m');
}
function ok(msg)   { say('  ✓  ' + msg + '\n', 'green'); }
function warn(msg) { say('  !  ' + msg + '\n', 'yellow'); }
function fail(msg) { say('  ✗  ' + msg + '\n', 'red'); }
function info(msg) { say(msg + '\n', 'cyan'); }
function scan(msg) { say('  ~  ' + msg + '\n', 'purple'); }
function progress(msg) { process.stdout.write('\r  ▶  ' + msg + '   '); }

function run(cmd, opts) {
  opts = opts || {};
  try { return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts }); }
  catch (e) { if (opts.silent) throw new Error(e.stderr || e.message); throw e; }
}

// ─── DNS & Network Helpers ─────────────────────────────────────────────────────

var dnsCache = {};
async function resolveHost(host) {
  if (dnsCache[host]) return dnsCache[host];
  return new Promise((resolve) => {
    const dns = require('dns');
    dns.lookup(host, (err, ip) => {
      if (err) {
        dnsCache[host] = null;
        resolve(null);
      } else {
        dnsCache[host] = ip;
        resolve(ip);
      }
    });
  });
}

async function fetchWithFallback(url, opts = {}) {
  var timeout = opts.timeout || 15000;
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e.message.indexOf('Abort') !== -1) {
      throw new Error('timeout_after_' + timeout + 'ms');
    }
    throw e;
  }
}

// ─── Retry with Exponential Backoff ────────────────────────────────────────────

async function retry(fn, maxRetries, label) {
  maxRetries = maxRetries || MAX_RETRY;
  label = label || 'operation';
  var lastErr = null;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      var retryable = e.message && (
        e.message.indexOf('429') !== -1 || e.message.indexOf('rate') !== -1 ||
        e.message.indexOf('timeout') !== -1 || e.message.indexOf('ECONNRESET') !== -1 ||
        e.message.indexOf('fetch failed') !== -1
      );
      if (!retryable || attempt >= maxRetries) {
        if (attempt >= maxRetries) fail('  ' + label + ' failed after ' + maxRetries + ' attempts: ' + e.message.split('\n')[0]);
        throw e;
      }
      var delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1) + Math.random() * 500;
      info('  -> ' + label + ' failed (attempt ' + attempt + '/' + maxRetries + '), retrying in ' + Math.round(delay/1000) + 's...');
      await new Promise(function(r) { setTimeout(r, delay); });
    }
  }
}

// ─── Health Monitor ────────────────────────────────────────────────────────────

var monitorInterval = null;
var monitorState = { running: false };

async function startHealthMonitor() {
  if (monitorInterval) return;
  monitorState.running = true;
  info('  🩺 Health monitor started (scans every ' + (HEALTH_INTERVAL_MS/1000) + 's)\n');
  
  async function tick() {
    if (!monitorState.running) return;
    try {
      var lb = loadLeaderboard();
      var now = Date.now();
      // Auto-heal: close circuit breakers for providers idle > 5min
      for (var pid in circuitBreakers) {
        var cb = circuitBreakers[pid];
        if (cb.state === 'open' && now - cb.lastFailure > 300000) {
          cb.state = 'half-open';
          info('  🔄 Auto-healed: ' + (PROVIDERS[pid]?.name || pid) + ' circuit reset\n');
        }
      }
      // Periodic full scan every 5 minutes
      if (lb.updated && now - new Date(lb.updated).getTime() > 300000) {
        info('  ~ Auto-scanning providers...\n');
        await runFullScan(false);
      }
      // Export metrics
      exportMetrics();
    } catch(e) {
      // Silent fail - don't crash monitor
    }
  }
  
  tick(); // Run immediately
  monitorInterval = setInterval(tick, HEALTH_INTERVAL_MS);
}

function stopHealthMonitor() {
  monitorState.running = false;
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
}

async function probeProvider(pid, endpoint) {
  var config = PROVIDERS[pid];
  if (!config) return { ok: false, error: 'unknown' };
  var key = null;
  if (config.requiresKey) {
    key = process.env[config.requiresKey] || null;
    if (!key && loadConfig().providers?.[pid]?.key) key = loadConfig().providers[pid].key;
  }
  if (config.requiresKey && !key) return { ok: false, error: 'missing_key', skipped: true };

  var t0 = Date.now();
  try {
    var url = typeof endpoint.url === 'function' ? (endpoint.url(key) || endpoint.url) : endpoint.url;
    var drift = detectDrift(pid, url);
    if (drift.drifted) info('  ~  Drift: ' + config.name + ' updated (' + drift.old + ' -> ' + drift.new + ')');

    // DNS check for critical providers
    var host = url.replace('https://', '').replace('http://', '').split('/')[0];
    var dnsResult = await resolveHost(host);
    if (!dnsResult && host.indexOf('localhost') === -1) {
      return { ok: false, latency: Date.now()-t0, error: 'dns_failed', host: host };
    }

    if (endpoint.type === 'simple') {
      var resp = await fetchWithFallback(url, { method: 'GET', timeout: endpoint.timeout || 10000 });
      var ms = Date.now() - t0;
      var body = await resp.text();
      if (resp.ok && body && body.length > 3) return { ok: true, latency: ms, status: resp.status };
      return { ok: false, latency: ms, error: 'empty', status: resp.status };
    }

    var body = endpoint.body(key, [{ role: 'user', content: 'say ok' }]);
    var headers = endpoint.headers(key);
    var resp = await fetchWithFallback(url, { method: 'POST', headers: headers, body: body, timeout: endpoint.timeout || 15000 });
    var ms = Date.now() - t0;
    var data = await resp.json().catch(() => ({}));
    if (resp.status === 200 && data.choices?.[0]?.message) return { ok: true, latency: ms, status: 200 };
    if (resp.status === 429 || data.error?.code === 'rate_limit_exceeded') return { ok: false, latency: ms, error: 'rate_limited', status: 429 };
    if (resp.status === 401 || resp.status === 403) return { ok: false, latency: ms, error: 'auth_failed', status: resp.status };
    if (resp.status === 410 || data.type === 'Gone') return { ok: false, latency: ms, error: 'deprecated', status: 410 };
    return { ok: false, latency: ms, error: data.error?.message || 'http_' + resp.status, status: resp.status };
  } catch (e) {
    return { ok: false, latency: Date.now()-t0, error: e.message };
  }
}

async function runFullScan(verbose) {
  scan('Scanning ' + Object.keys(PROVIDERS).length + ' providers...');
  var lb = loadLeaderboard();
  lb.providers = lb.providers || {};
  lb.updated = new Date().toISOString();
  for (var i = 0; i < Object.keys(PROVIDERS).length; i++) {
    var pid = Object.keys(PROVIDERS)[i];
    var config = PROVIDERS[pid];
    if (verbose) progress(pid + '...');
    var result = await probeProvider(pid, config.endpoints[0]);
    var stats = lb.providers[pid] || { probes: 0, successes: 0, totalLatency: 0, lastOk: null, streak: 0 };
    stats.lastProbe = new Date().toISOString();
    stats.lastStatus = result.ok ? 'ok' : (result.error || 'error');
    if (result.ok) { stats.successes++; stats.probes++; stats.totalLatency += result.latency||0; stats.lastOk = new Date().toISOString(); stats.streak = (stats.streak||0)+1; stats.avgLatency = stats.totalLatency/stats.successes; }
    else { stats.streak = 0; stats.lastError = result.error; stats.probes++; }
    lb.providers[pid] = stats;
  }
  var scored = [];
  for (var pid in lb.providers) {
    var s = lb.providers[pid];
    if (!s.lastProbe) continue;
    var q = PROVIDERS[pid] ? (PROVIDERS[pid].qualityScore||50) : 50;
    var rel = s.probes>0 ? (s.successes/s.probes)*100 : 0;
    var lat = s.avgLatency>0 ? Math.max(0,100-s.avgLatency/100) : 50;
    var rec = s.lastOk ? Math.min(100,100-((Date.now()-new Date(s.lastOk).getTime())/60000)*2) : 0;
    scored.push({ id:pid, name:PROVIDERS[pid]?.name||pid, score:Math.round(q*.35+rel*.30+lat*.20+rec*.15), reliability:Math.round(rel), latency:s.avgLatency, streak:s.streak, category:PROVIDERS[pid]?.category||'?' });
  }
  scored.sort(function(a,b){return b.score-a.score;});
  lb.ranked = scored;
  saveLeaderboard(lb);
  return scored;
}

// ─── Core Router: callWithBestProvider ─────────────────────────────────────────

async function callWithBestProvider(prompt, sessionId, forceProvider) {
  var lb = loadLeaderboard();
  var session = sessionId ? loadSession(sessionId) : null;
  if (!session) session = { id: sessionId||'default', messages: [], fallbacks: [], createdAt: Date.now() };

  // Build candidate list: force-specific, then ranked, then all
  // Bootstrap providers (pollinations) are always tried last if no keys available
  var allProviderIds = Object.keys(PROVIDERS);
  var candidates = forceProvider ? [forceProvider] : (lb.ranked && lb.ranked.length > 0 ? lb.ranked.map(r=>r.id) : allProviderIds);

  // Always include bootstrap providers in candidates (for fallback)
  var bootstrapProvs = allProviderIds.filter(function(pid) { return PROVIDERS[pid]?.category === 'bootstrap'; });
  var realProvs = allProviderIds.filter(function(pid) { return PROVIDERS[pid]?.category !== 'bootstrap'; });

  // If leaderboard doesn't include all providers, supplement with missing ones
  var candidateSet = {};
  candidates.forEach(function(pid){ candidateSet[pid] = true; });
  realProvs.forEach(function(pid){ if(!candidateSet[pid]) candidates.push(pid); });;

  // Filter: viable = has key or no key needed, circuit closed, not rate-limited, local checks pass
  // Bootstrap providers are NEVER in the main viable list — they're fallback only
  var viable = realProvs.filter(function(pid) {
    var p = PROVIDERS[pid]; if (!p) return false;
    if (p.requiresKey) {
      var hasKey = !!(process.env[p.requiresKey] || (loadConfig().providers?.[pid]?.key));
      return hasKey;
    }
    // Skip local providers that aren't running
    if (p.category === 'free_local') {
      try {
        var url = typeof p.endpoints[0].url === 'function' ? p.endpoints[0].url() : p.endpoints[0].url;
        var host = url.replace('http://','').replace('https://','').split('/')[0];
        if (host.indexOf('localhost') !== -1 || host.indexOf('127.0.0.1') !== -1) {
          require('child_process').execSync('curl -s --max-time 2 ' + url.split(':')[2].replace('//','') + '/api/tags',{stdio:'pipe'});
        }
      } catch(e) { return false; }
    }
    if (rateLimits[pid] && rateLimits[pid].consecutive429 >= 3) return false;
    var cb = getCircuitState(pid);
    if (cb.state === 'open') return false;
    return true;
  });

  if (viable.length === 0) {
    // No real providers viable — fall through to bootstrap fallback below
    info('  No configured providers available. Will try bootstrap fallback...\n');
  }

  info('  Trying ' + viable.length + ' provider(s)...\n');

  // Try in parallel batches
  var result = null, usedProvider = null;
  var batchSize = Math.min(PARALLEL_PROVIDERS, viable.length);

  for (var batchStart = 0; batchStart < viable.length; batchStart += batchSize) {
    var batch = viable.slice(batchStart, batchStart + batchSize);
    var batchResults = await Promise.all(batch.map(function(pid) {
      return trySingleProvider(pid, prompt, session).catch(function(e) {
        return { pid: pid, error: e.message.split('\n')[0] };
      });
    }));

    for (var j = 0; j < batchResults.length; j++) {
      var r = batchResults[j];
      if (r && r.result) {
        result = r;
        usedProvider = r.pid;
        recordSuccess(r.pid);
        break;
      } else if (r && r.error) {
        if (r.error.indexOf('deprecated_410') !== -1) {
          warn('  ' + (PROVIDERS[r.pid]?.name||r.pid) + ' deprecated (410), skipping...');
        } else {
          warn('  ' + (PROVIDERS[r.pid]?.name||r.pid) + ': ' + r.error);
        }
        recordFailure(r.pid, r.error);
      }
    }
    if (result) break;
  }

  if (!result) {
    // All real providers failed — try bootstrap fallback (sequential, no parallel)
    // Bootstrap providers are rate-limited — wait before trying
    if (bootstrapProvs.length > 0) {
      info('\n  All configured providers failed. Waiting before bootstrap fallback...\n');
      await new Promise(function(r){setTimeout(r, 3000);}); // Wait 3s before bootstrap
      for (var b = 0; b < bootstrapProvs.length; b++) {
        var bp = bootstrapProvs[b];
        // Skip if recently rate-limited
        if (rateLimits[bp] && rateLimits[bp].consecutive429 >= 1) {
          var rl = rateLimits[bp];
          var rlAge = Date.now() - rl.lastReset;
          if (rlAge < 30000) {
            warn('  ' + bp + ' rate-limited, waiting ' + Math.round((30000-rlAge)/1000) + 's...\n');
            await new Promise(function(r){setTimeout(r, Math.min(30000-rlAge, 15000));});
          }
        }
        try {
          // Bootstrap: 1 retry only, with longer timeout
          var br = await trySingleProvider(bp, prompt, session, 1);
          if (br && br.result) {
            result = br;
            usedProvider = br.pid;
            recordSuccess(br.pid);
            break;
          }
        } catch(e) { warn('  ' + bp + ': ' + e.message.split('\n')[0]); }
        // Longer delay between bootstrap attempts
        if (b < bootstrapProvs.length - 1) { await new Promise(function(r){setTimeout(r,3000)}); }
      }
    }
    if (!result) {
      fail('\n  All providers exhausted.');
      info('\n  Get a free key in 10 seconds (no credit card):\n');
      for (var i = 0; i < realProvs.length; i++) {
        var cp = PROVIDERS[realProvs[i]];
        if (cp && cp.signupUrl) {
          info('    ' + cp.name.padEnd(20) + ' → ' + cp.signupUrl);
        }
      }
      info('\n  Then: chode auth <provider> [your-key]\n');
      info('  Or run: chode provision\n');
      return null;
    }
  }

  session.lastProvider = usedProvider;
  session.messages.push({ role:'user', content:prompt, ts:Date.now() });
  session.messages.push({ role:'assistant', content:result.result, ts:Date.now(), provider:usedProvider });
  if (session.messages.length > 50) session.messages = session.messages.slice(-50);
  if (sessionId) saveSession(session);
  saveCheckpoint({ taskId: sessionId||'default', lastProvider: usedProvider, lastPrompt: prompt, lastResult: result.result, ts: Date.now() });
  recordUsage(usedProvider, result.tokens||0, result.latency||0);

  return { result: result.result, provider: usedProvider, providerName: PROVIDERS[usedProvider]?.name, latency: result.latency };
}

async function trySingleProvider(pid, prompt, session, maxRetries) {
  var config = PROVIDERS[pid];
  if (!config) throw new Error('unknown_provider');
  var endpoint = config.endpoints[0];
  var key = config.requiresKey ? (process.env[config.requiresKey] || (loadConfig().providers?.[pid]?.key)) : null;
  var url = typeof endpoint.url === 'function' ? (endpoint.url(key) || endpoint.url) : endpoint.url;
  detectDrift(pid, url);

  // Check DNS before attempting request
  var host = url.replace('https://', '').replace('http://', '').split('/')[0];
  if (host.indexOf('localhost') === -1) {
    var dnsOk = await resolveHost(host);
    if (!dnsOk) throw new Error('dns_failed:' + host);
  }

  var t0 = Date.now();
  var msgs = session.messages.length > 0 ? session.messages.concat([{role:'user',content:prompt}]) : [{role:'user',content:prompt}];

  return await retry(async function() {
    if (endpoint.type === 'simple') {
      var resp = await fetchWithFallback(url, { signal: AbortSignal.timeout(endpoint.timeout||15000) });
      var body = await resp.text();
      if (resp.ok && body && body.length > 2) return { pid:pid, result:body, latency:Date.now()-t0, tokens:Math.ceil(body.length/4) };
      throw new Error('empty_response (' + resp.status + ')');
    } else {
      var chatBody = endpoint.body(key, msgs);
      var chatHeaders = endpoint.headers(key);
      var resp = await fetchWithFallback(url, { method:'POST', headers:chatHeaders, body:chatBody, signal:AbortSignal.timeout(endpoint.timeout||15000) });
      var data = await resp.json().catch(()=>({}));
      if (resp.status === 200 && data.choices?.[0]?.message?.content) {
        return { pid:pid, result:endpoint.parse(data), latency:Date.now()-t0, tokens:Math.ceil(data.choices[0].message.content.length/4) };
      }
      if (resp.status === 410 || data.type === 'Gone') throw new Error('deprecated_410');
      if (resp.status === 429) throw new Error('429_rate_limited');
      throw new Error(resp.status + ':' + (data.error?.message || ''));
    }
  }, maxRetries || MAX_RETRY, 'call to ' + (config?.name || pid));
}

// ─── Commands ──────────────────────────────────────────────────────────────────

function cmdModels() {
  info('\n  AI Models\n  ' + '─'.repeat(50) + '\n');
  var providers = Object.keys(PROVIDERS);
  for (var i = 0; i < providers.length; i++) {
    var pid = providers[i];
    var p = PROVIDERS[pid];
    var hasKey = p.requiresKey ? !!(process.env[p.requiresKey] || (loadConfig().providers?.[pid]?.key)) : true;
    var icon = hasKey ? '\u2713' : '\u25cb';
    var tier = p.category === 'free_tier' ? 'FREE' : (p.category === 'free_local' ? 'LOCAL' : (p.category === 'bootstrap' ? 'BOOTSTRAP' : 'PAID'));
    say('  ' + icon + ' ' + pid.padEnd(14), hasKey?'green':'white');
    info('  ' + p.name.padEnd(28) + tier, 'dim');
  }
  info('\n  Quick start:\n    chode scan        Discover working providers\n    chode ai "hello"  Test auto-routing\n    chode provision   Auto-request free-tier keys\n');
}

async function cmdScan() {
  info('\n  chode scan — Full free-tier health probe\n');
  info('  Testing all ' + Object.keys(PROVIDERS).length + ' providers...\n');
  var scored = await runFullScan(true);
  showQuickScore();
  return scored;
}

function cmdScore() {
  var lb = loadLeaderboard();
  if (!lb.ranked||lb.ranked.length===0) { warn('No scan data. Run `chode scan` first.'); return; }
  info('\n  chode score — Live Provider Leaderboard\n  Updated: '+(lb.updated?new Date(lb.updated).toLocaleString():'never')+'\n');
  info('  Rank  Provider'.padEnd(30)+'Score  Rel      Latency  Tier\n');
  info('  '+'─'.repeat(72)+'\n');
  for (var i=0;i<lb.ranked.length;i++) {
    var r=lb.ranked[i], icon=r.score>=70?'\u2713':(r.score>=40?'○':'x'),
         cat=r.category==='free_tier'?'FREE':(r.category==='free_local'?'LOCAL':'PAID'),
         lat=r.latency?Math.round(r.latency)+'ms':'---';
    say('  '+icon+' #'+String(i+1).padEnd(3)+' '+r.name.padEnd(22), r.score>=70?'green':'white');
    info(' '+String(r.score).padStart(3)+'    '+String(r.reliability).padStart(3)+'%       '+lat.padEnd(8)+' '+cat+'\n','dim');
  }
  info('\n  Top: '+(lb.ranked[0]?.name||'none')+'\n');
}

function cmdStatus() {
  var lb = loadLeaderboard();
  var usage = loadUsage();
  info('\n  ═══ chode Status ═══\n');
  info('  Providers:\n');
  for (var pid in PROVIDERS) {
    var p = PROVIDERS[pid];
    var hasKey = !p.requiresKey || !!(process.env[p.requiresKey] || (loadConfig().providers?.[pid]?.key));
    var cb = getCircuitState(pid);
    var icon = hasKey ? '✓' : '○';
    var status = hasKey ? 'ready' : 'no key';
    if (cb && cb.state === 'open') { status += ' [CIRCUIT OPEN]'; icon = '⚠'; }
    else if (cb && cb.failures > 0) { status += ' ('+cb.failures+' failures)'; }
    var usg = usage.providers[pid];
    var uStr = usg ? usg.requests+'req '+usg.tokens+'tok '+usg.errors+'err' : '';
    say('  '+icon+' '+pid.padEnd(16), icon==='✓'?'green':'white');
    info('   '+p.name.padEnd(24)+status.padEnd(30)+uStr+'\n','dim');
  }
  var cp = loadCheckpoint();
  if (cp) info('\n  Last Checkpoint: provider='+(PROVIDERS[cp.lastProvider]?.name||cp.lastProvider)+' ts='+new Date(cp.ts).toLocaleString()+'\n','yellow');
  var queues = listWorkQueues();
  if (queues.length > 0) {
    info('\n  Active Projects:\n');
    for (var k=0;k<queues.length;k++) {
      var q=queues[k], done=q.steps?q.steps.filter(function(s){return s.done;}).length:0;
      info('    ['+q.id+'] '+done+'/'+(q.steps?q.steps.length:0)+' steps'+(q.completed?' ✓ DONE':'')+'\n','dim');
    }
  }
  try { require('child_process').execSync('curl -s http://localhost:11434/api/tags',{encoding:'utf8',stdio:'pipe'}); info('\n  Ollama: running ✓\n'); } catch(e) { info('\n  Ollama: not running (install: winget install Ollama.Ollama)\n'); }
  info('  Commands: chode ai "prompt" | chode provision | chode status | chode scan\n');
}

async function cmdAI(rawArgs) {
  var args = parseArgs(rawArgs);
  var sessionId = args.session || args[0];
  var prompt = args.prompt;
  var force = args.force;
  var resume = args.resume;

  // Checkpoint recovery
  var checkpoint = loadCheckpoint();
  if (checkpoint && checkpoint.lastPrompt && !prompt && !resume) {
    info('\n  Resuming from checkpoint (' + new Date(checkpoint.ts).toLocaleString() + ')\n');
    info('  Last provider: ' + checkpoint.lastProvider + '\n');
    var restoredSession = loadSession(checkpoint.taskId || 'default');
    if (restoredSession.messages.length > 0) {
      info('  Restoring ' + restoredSession.messages.length + ' messages from session\n');
      session = restoredSession;
    }
    prompt = '[RESUME] Previous conversation context restored. Continue from where we left off.';
  }

  if (!sessionId && !prompt) {
    info('\n  chode AI — Self-Healing Session\n');
    showQuickScore();
    var lastSession = loadSession(null);
    if (lastSession.messages.length > 0) info('  Resuming session with ' + lastSession.messages.length + ' messages\n');
    else info('  Fresh session. Type your prompt (or Ctrl+C to exit):\n');
    info('  Commands: exit, heal, scan, score, status\n');

    function askNext(fastProvider) {
      process.stdout.write('  > ');
      process.stdin.resume(); process.stdin.setEncoding('utf8');
      var afkTimer = setTimeout(function() {
        var lb = loadLeaderboard();
        var fastest = lb.ranked && lb.ranked.length > 0 ? lb.ranked[0].id : null;
        if (fastest) info('\n  [AFK — switching to: ' + (PROVIDERS[fastest]?.name||fastest) + ']\n');
        else info('\n  [AFK — run `chode scan` to discover providers]\n');
        askNext(fastProvider);
      }, AFK_TIMEOUT*1000);
      process.stdin.once('data', function(chunk) {
        clearTimeout(afkTimer);
        var line = chunk.toString().trim();
        if (!line) { askNext(); return; }
        if (line==='exit'||line==='quit'||line==='\x03') { clearCheckpoint(); info('  Session saved. Goodbye.\n'); process.exit(0); }
        if (line==='heal'||line==='switch') { info('  Re-scanning providers...\n'); cmdScan().then(function(){askNext(null)}); return; }
        if (line==='scan') { cmdScan().then(function(){askNext(null)}); return; }
        if (line==='score') { cmdScore(); askNext(fastProvider); return; }
        if (line==='status') { cmdStatus(); askNext(fastProvider); return; }
        if (line==='checkpoint') { var cp=loadCheckpoint(); info(cp?'  Checkpoint: '+JSON.stringify(cp):'  No checkpoint'); askNext(fastProvider); return; }
        if (line==='clear') { clearCheckpoint(); info('  Checkpoint cleared'); askNext(fastProvider); return; }
        info('  → Calling AI (parallel routing, '+MAX_RETRY+' retries)...\n');
        cmdAI({session:sessionId,prompt:line,force:force,resume:resume,fastProvider:fastProvider}).then(function(res) {
          if (res) {
            if (res.provider!==res.providerName) info('  ⚡ Routed: ' + res.providerName + ' (' + res.provider + ')\n');
            console.log('\n  ' + res.result + '\n');
          }
          askNext(fastProvider);
        });
      });
    }
    askNext(null);
    return;
  }

  info('  → Calling AI (parallel routing, ' + MAX_RETRY + ' retries)...\n');
  var res = await callWithBestProvider(prompt, sessionId, force);
  if (res) {
    if (res.provider !== res.providerName) info('  ⚡ Routed to: ' + res.providerName + ' (' + res.provider + ')\n');
    console.log(res.result);
  }
}

function parseArgs(argv) {
  var r = { session:null, prompt:'', force:null, resume:false };
  for (var i=0;i<argv.length;i++) {
    if (argv[i]==='--session'&&argv[i+1]) r.session=argv[++i];
    else if (argv[i]==='--force'&&argv[i+1]) r.force=argv[++i];
    else if (argv[i]==='--resume') r.resume=true;
    else if (!argv[i].startsWith('--')) r.prompt+=(r.prompt?' ':'')+argv[i];
  }
  return r;
}

function clearCheckpoint() {
  try { fs.unlinkSync(CHECKPOINT_FILE); } catch(e) {}
}

async function cmdProject(spec) {
  info('\n  chode project — Multi-provider orchestration\n');

  var steps;
  try { steps = JSON.parse(spec); }
  catch { steps = null; }

  if (!steps) {
    info('  Scanning providers...\n');
    var scored = await runFullScan(false); showQuickScore();
    info('\n  Decomposing: "' + spec + '"\n');
    var planResult = await callWithBestProvider('Break into numbered steps (one per line, no explanations): ' + spec, null, null);
    if (!planResult) { warn('Planning failed. Using defaults.'); steps = [{desc:'Analyze:'+spec},{desc:'Plan'},{desc:'Execute'}]; }
    else {
      var lines = planResult.result.split('\n').filter(function(l){return l.trim();});
      steps = lines.map(function(l,i){return {desc:l.trim(),index:i+1};});
    }
  } else if (Array.isArray(spec)) {
    steps = spec.map(function(s,i){ return typeof s==='string' ? {desc:s,index:i+1} : s; });
  }

  var qid = 'proj_' + Date.now();
  var q = loadWorkQueue(qid);
  if (!q) {
    q = { id: qid, spec: spec, steps: steps.map(function(s){ return {desc:s.desc,done:false,result:null,provider:null,error:null}; }), startedAt: Date.now() };
    saveWorkQueue(q);
  }

  var startIdx = 0;
  for (var i = 0; i < q.steps.length; i++) { if (!q.steps[i].done) { startIdx = i; break; } }

  info('  Plan: ' + q.steps.length + ' steps (starting at ' + (startIdx+1) + ')\n');
  var results = [];

  for (var i = startIdx; i < q.steps.length; i++) {
    var step = q.steps[i];
    info('\n  ['+(i+1)+'/'+q.steps.length+'] ' + step.desc.slice(0,60));

    saveCheckpoint({ taskId: qid, stepIndex: i, stepDesc: step.desc, ts: Date.now() });

    var scored = await runFullScan(false);
    var topProvs = scored.slice(0, PARALLEL_PROVIDERS).map(function(r){return r.id;});
    var attempts = await Promise.all(topProvs.map(function(pid) {
      return callWithBestProvider(step.desc, qid, pid).catch(function(e) { return null; });
    }));

    var stepResult = null, stepProvider = null;
    for (var j = 0; j < attempts.length; j++) { if (attempts[j] && attempts[j].result) { stepResult = attempts[j].result; stepProvider = attempts[j].provider; break; } }

    if (stepResult) {
      ok('  Done via ' + (PROVIDERS[stepProvider]?.name||stepProvider));
      q.steps[i].done = true; q.steps[i].result = stepResult; q.steps[i].provider = stepProvider;
      q.completedSteps = (q.completedSteps||0) + 1;
      results.push({step:i+1,result:stepResult.slice(0,300),provider:stepProvider});
    } else {
      warn('  Failed — no provider succeeded');
      q.steps[i].error = 'all_failed';
      results.push({step:i+1,error:'all_failed'});
    }
    saveWorkQueue(q);
  }

  q.completed = results.every(function(r){return r.result;});
  q.completedAt = Date.now();
  saveWorkQueue(q);

  info('\n  Complete: ' + results.filter(function(r){return r.result;}).length + '/' + results.length + ' steps\n');
  info('  Resume: chode project --resume ' + qid + '\n');
  return results;
}

async function cmdProjectResume(qid) {
  var q = loadWorkQueue(qid);
  if (!q) { fail('Not found: ' + qid); return; }
  info('\n  Resuming: ' + qid + ' (' + (q.completedSteps||0) + '/' + q.steps.length + ' done)\n');
  cmdProject(JSON.stringify(q.steps.map(function(s){return s.desc;})));
}

async function cmdHeal() {
  info('\n  chode heal — Force provider diagnostics\n');
  // Reset all circuit breakers
  circuitBreakers = {};
  rateLimits = {};
  await runFullScan(true);
}

function cmdSession(action) {
  var sid = process.argv[4];
  var sessions=[];
  try {
    var files = fs.readdirSync(SESSION_DIR);
    for (var i=0;i<files.length;i++) {
      if (files[i].endsWith('.json')) {
        try { sessions.push(JSON.parse(fs.readFileSync(path.join(SESSION_DIR,files[i]),'utf8'))); } catch(e) {}
      }
    }
  } catch(e) {}
  if (action === 'list' || !action) {
    info('\n  Sessions (' + sessions.length + '):\n');
    if (sessions.length === 0) { info('  No sessions yet. Start one with: chode ai\n'); return; }
    for (var j=0;j<sessions.length;j++) {
      var s=sessions[j];
      info('  ' + s.id.padEnd(16) + ' msgs:' + String(s.messages?s.messages.length:0).padEnd(4) + ' provider:' + (s.lastProvider||'none').padEnd(12) + ' created:' + new Date(s.createdAt).toLocaleString() + '\n','dim');
    }
  } else if (action === 'show' && sid) {
    var sess = loadSession(sid);
    info('\n  Session: ' + sess.id + ' (' + sess.messages.length + ' messages)\n');
    for (var k=0;k<sess.messages.length;k++) {
      var m=sess.messages[k];
      var role=m.role==='user'?'you':'AI';
      info('  ['+role+'] '+m.content.slice(0,100)+(m.content.length>100?'...':'')+(m.provider?' ('+m.provider+')':'')+'\n','dim');
    }
  } else if (action === 'reset') {
    try { fs.unlinkSync(path.join(SESSION_DIR, 'default.json')); info('  Default session cleared.\n'); }
    catch(e) { info('  No default session to clear.\n'); }
    var allSessions = fs.readdirSync(SESSION_DIR).filter(function(f){return f.endsWith('.json');});
    for (var r=0;r<allSessions.length;r++) {
      try { fs.unlinkSync(path.join(SESSION_DIR, allSessions[r])); } catch(e) {}
    }
    ok('All sessions cleared (' + allSessions.length + ' removed)\n');
  }
}

async function cmdAuth() {
  info('\n  chode auth — Manage API keys\n');
  var providers = loadConfig().providers || {};
  if (Object.keys(providers).length === 0) {
    info('  No keys configured.\n');
    info('  Free-tier keys (no CC required):\n');
    for (var pid in PROVIDERS) {
      var p = PROVIDERS[pid];
      if (p.category === 'free_tier' && p.signupUrl) {
        info('    ' + p.name.padEnd(30) + p.freeTier + '\n    ' + '    ' + p.signupUrl + '\n','dim');
      }
    }
    info('\n  Set a key: chode auth groq [your-key-here]\n');
    info('  Or auto-provision: chode provision\n');
    return;
  }
  info('  Configured keys:\n');
  for (var pid in providers) {
    var p = providers[pid];
    var masked = p.key ? p.key.slice(0,4) + '...' + p.key.slice(-4) : '(none)';
    var icon = p.key ? '✓' : '○';
    say('  ' + icon + ' ' + pid + '\n', p.key ? 'green' : 'white');
    info('    Key: ' + masked + '\n','dim');
  }
  info('\n  Update: chode auth <provider> <new-key>\n');
  info('  Remove: chode auth <provider> --remove\n');
}

// ─── Key Validation ─────────────────────────────────────────────────────────────
async function validateKey(providerId, key) {
  var config = PROVIDERS[providerId];
  if (!config) return { valid: false, error: 'unknown_provider' };
  
  var endpoint = config.endpoints[0];
  var url = typeof endpoint.url === 'function' ? endpoint.url(key) : endpoint.url;
  var headers = endpoint.headers(key);
  var body = endpoint.body(key, [{role:'user',content:'test'}]);
  
  try {
    var resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body,
      signal: AbortSignal.timeout(5000)
    });
    
    var data = await resp.json().catch(() => ({}));
    
    if (resp.status === 200 && data.choices?.[0]) {
      return { valid: true, provider: providerId };
    }
    
    if (resp.status === 401) return { valid: false, error: 'invalid_key' };
    if (resp.status === 429) return { valid: true, error: 'rate_limited' };
    return { valid: false, error: 'http_' + resp.status };
  } catch (e) {
    return { valid: false, error: e.message.includes('timeout') ? 'timeout' : 'connection_failed' };
  }
}

function getErrorMessage(errorCode) {
  var messages = {
    'unknown_provider': 'Unknown provider',
    'invalid_key': 'Invalid API key. Check and try again.',
    'rate_limited': 'Key valid but rate-limited. Try again later.',
    'timeout': 'Request timed out. Check your connection.',
    'connection_failed': 'Cannot connect to provider. Check internet.'
  };
  return messages[errorCode] || 'Unknown error: ' + errorCode;
}

async function cmdProvision(providerArg) {
  info('\n  chode provision — Auto-request free-tier API keys\n');
  // Get all free-tier providers that need keys
  var providers = [];
  var existing = loadConfig().providers || {};
  for (var pid in PROVIDERS) {
    var p = PROVIDERS[pid];
    if (p.category === 'free_tier' && p.requiresKey) {
      if (!existing[pid] || !existing[pid].key) {
        providers.push(pid);
      }
    }
  }
  if (providerArg && providers.indexOf(providerArg) === -1) { warn('Unknown provider: ' + providerArg); info('  Available: ' + providers.join(', ') + '\n'); return; }
  if (providerArg) providers = [providerArg];

  if (providers.length === 0) { ok('No keys to provision. All free-tier providers have keys.\n'); return; }

  info('  Requesting keys for: ' + providers.map(function(p){return PROVIDERS[p]?.name||p;}).join(', ') + '\n');
  info('  Note: HEMO mail may not be available from all environments.\n');
  info('  You will need to sign up at each provider and run: chode auth <provider> <key>\n\n');

  var sent = 0;
  for (var i=0;i<providers.length;i++) {
    var pid = providers[i];
    var config = PROVIDERS[pid];
    info('  ['+(i+1)+'/'+providers.length+'] ' + config.name + ':\n');
    info('    Signup: ' + (config.signupUrl||'N/A') + '\n');
    info('    Free tier: ' + (config.freeTier||'Check docs') + '\n\n');
    sent++;
  }

  info('  To activate, run for each provider:\n');
  for (var j=0;j<providers.length;j++) {
    info('    chode auth ' + providers[j] + ' [your-api-key]\n');
  }
  info('  Or use environment variables:\n');
  for (var k=0;k<providers.length;k++) {
    var cp = PROVIDERS[providers[k]];
    if (cp && cp.requiresKey) {
      info('    export ' + cp.requiresKey + '=[your-key]\n');
    }
  }
}

async function provisionViaHelio(providerId) {
  // Try HEMO mail to request a free-tier key
  // Note: HEMO mail may not be accessible from all environments
  var token = loadHeliosToken();
  if (!token) {
    info('    Creating HEMO agent identity...');
    token = await createHeliosAgent();
    if (!token) return null;
  }
  var config = PROVIDERS[providerId];
  if (!config) return null;
  info('\n    Sending key request for ' + config.name + ' to HEMO mail...\n');
  try {
    // Check if HEMO mail is reachable
    var dns = require('dns');
    await new Promise(function(resolve, reject) {
      dns.resolve('hemo-mail.oooooooooo.se', function(err) {
        if (err) reject(new Error('HEMO mail unreachable: ' + err.message));
        else resolve();
      });
    });
    var r = await fetch('https://hemo-mail.oooooooooo.se/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        to: 'keys@oooooooooo.se',
        subject: '[CHODE] Key request: ' + config.name,
        text: 'Provider: ' + config.name + ' (' + providerId + ')\n' +
              'Endpoint: ' + (typeof config.endpoints[0].url === 'function' ? 'see docs' : config.endpoints[0].url) + '\n' +
              'Free tier: ' + (config.freeTier||'check docs') + '\n' +
              'Signup: ' + (config.signupUrl||'') + '\n\n' +
              'Auto-provisioned by chode on ' + new Date().toISOString()
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) { var e2 = await r.text(); warn('HEMO mail send failed: ' + e2.slice(0,80)); return null; }
    return { ok: true };
  } catch (e) {
    warn('HEMO mail unavailable (' + e.message + '). Use manual signup:\n');
    var cfg = PROVIDERS[providerId];
    if (cfg && cfg.signupUrl) info('    ' + cfg.name + ' → ' + cfg.signupUrl + '\n');
    info('    Then run: chode auth ' + providerId + ' [your-key]\n');
    return null;
  }
}

function cmdNew(name, flags) {
  var slug = name.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase();
  if (flags.skill) return cmdNewSkill(slug);
  checkAndInstallDeps(ROOT);
  var featHtml = ['Production grade','HEMO integrated','Self-healing AI'].map(function(f){return '    <li style="padding:4px 0;color:#aab">• '+f+'</li>';}).join('\n');
  var htmlDoc = [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    '  <title>'+slug+' — chode</title>',
    '  <meta name="description" content="'+slug+' — self-healing Cloudflare Worker">',
    '  <style>',
    '    :root{--g:#22dd55;--bg:#0a0a0a;--text:#dff0e2;--muted:#7fa88a;--fm:"IBM Plex Mono",monospace;}',
    '    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    '    body{background:#000;color:var(--text);font-family:var(--fm);min-height:100vh;display:flex;align-items:center;justify-content:center}',
    '    .container{text-align:center;padding:40px}',
    '    h1{font-size:clamp(32px,5vw,64px);color:var(--g);margin-bottom:16px}',
    '    p{color:var(--muted);font-size:16px;line-height:1.6}',
    '    .badge{display:inline-block;background:rgba(34,221,85,.1);border:1px solid rgba(34,221,85,.3);border-radius:20px;padding:6px 16px;font-size:12px;color:var(--g);margin-top:20px}',
    '  </style>',
    '</head><body>',
    '<div class="container">',
    '  <h1>'+slug+'</h1>',
    '  <p>Scaffolded by chode — self-healing AI harness</p>',
    '  <div class="badge">Powered by chode · '+new Date().getFullYear()+'</div>',
    '</div></body></html>'
  ].join('\n');
  var escaped = htmlDoc.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
  var lines = [
    'const PAGE = `' + escaped + '`;',
    '',
    'export default {',
    '  async fetch(request, env) {',
    "    const url = new URL(request.url);",
    "    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });",
    "    if (url.pathname === '/api/status') return new Response(JSON.stringify({ ok: true, service: '" + slug + "', ts: Date.now() }), { headers: { 'content-type': 'application/json' } });",
    "    return new Response('Not found', { status: 404 });",
    '  },',
    '};'
  ].join('\n');
  write(slug+'/worker.js', lines);
  write(slug+'/wrangler.toml', ['name = "'+slug+'"','main = "worker.js"','compatibility_date = "2024-09-23"','','[vars]','SERVICE_NAME = "'+slug+'"',''].join('\n'));
  write(slug+'/package.json', '{\n  "name": "'+slug+'",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "wrangler dev",\n    "deploy": "wrangler deploy"\n  }\n}\n');
  ok('Scaffolded '+slug+'/');
  info('  worker.js      — self-healing AI worker\n');
  info('  Next: cd '+slug+' && npx wrangler dev\n');
}

function cmdNewSkill(slug) {
  var md = ['---','name: '+slug,'type: technique','description: >','  '+slug.replace(/-/g,' ')+' — HEMO skill.','---','',
    '# '+slug,'',slug.replace(/-/g,' ')+' is a HEMO economy skill.',
    '','## Usage','','```','chode skills install '+slug,'```','',
    '## Conventions','- Follow the HEMO doctrine','- Rate-limit aware'].join('\n');
  write('skills/'+slug+'/SKILL.md', md);
  ok('Scaffolded skill: '+slug);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function checkAndInstallDeps(dir) {
  for (var name in GLOBAL_DEPS) {
    var dep = GLOBAL_DEPS[name];
    if (!dep.check && dep.cmd) {
      try { execSync(dep.cmd, {stdio:'pipe'}); } catch(e) { if (dep.required) fail('Missing: ' + dep.name + ' — run `chode deps install`'); }
    }
  }
}

async function cmdQuickKey(providerId) {
  var config = PROVIDERS[providerId];
  if (!config) {
    fail('Unknown provider: ' + providerId);
    info('\n  Available providers:');
    for (var pid in PROVIDERS) {
      var p = PROVIDERS[pid];
      if (p.requiresKey) info('    ' + pid.padEnd(15) + p.name + ' → ' + p.signupUrl);
    }
    return;
  }
  info('\n  ' + config.name + '\n');
  info('  Free tier: ' + (config.freeTier||'Check docs') + '\n');
  info('  Signup: ' + (config.signupUrl||'N/A') + '\n');
  info('  Command to save key:\n');
  info('    chode auth ' + providerId + ' [your-api-key]\n\n');
  info('  Or set environment variable:\n');
  info('    export ' + (config.requiresKey||providerId.toUpperCase() + '_API_KEY') + '=[your-key]\n');
}

async function cmdUpdate() {
  info('\n  chode update — Checking for updates...\n');
  try {
    var latest = JSON.parse(execSync('npm view OLDGREG version',{encoding:'utf8'}).trim());
    var current = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version||'0.0.0';
    if (compareVer(current, latest) >= 0) { ok('chode is up to date (' + current + ')'); }
    else { warn('Update available: ' + current + ' → ' + latest); info('  Run: npm update -g OLDGREG\n'); }
  } catch(e) { warn('Update check failed: ' + e.message); }
}

function cmdInit() {
  info('\n  chode init — One-time setup\n');
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(MONITOR_DIR, { recursive: true });
  var cfg = loadConfig();
  if (!cfg.heliosToken) {
    info('  Creating HEMO agent identity...\n');
    createHeliosAgent().then(function(token) {
      if (token) ok('HEMO agent ready');
      else info('  HEMO agent creation skipped (run manually if needed)\n');
      nextStep();
    });
  } else { nextStep(); }
  function nextStep() {
    info('\n  Setup complete. Next steps:\n');
    info('    chode scan          Discover working free-tier providers\n');
    info('    chode provision     Auto-request free API keys via HEMO mail\n');
    info('    chode ai            Start AI session with auto-routing\n');
    info('    chode status        Full health dashboard\n');
  }
}

async function createHeliosAgent() {
  var existing = loadHeliosToken();
  if (existing) return existing;
  info('  Creating HEMO agent identity via HELIOS...');
  var username = 'chode-' + Date.now().toString(36).slice(-6);
  try {
    var r = await fetch('https://ai.oooooooooo.se/api/v1/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username }), signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) { var e = await r.text(); fail('HELIOS create failed: ' + e.slice(0,100)); return null; }
    var d = await r.json();
    if (d.token) { saveHeliosToken(d.token); ok('HEMO agent created: ' + username); return d.token; }
    fail('HELIOS response missing token'); return null;
  } catch (e) { fail('HELIOS unreachable: ' + e.message); return null; }
}

function loadHeliosToken() { var cfg = loadConfig(); return cfg.heliosToken; }
function saveHeliosToken(token) { var cfg = loadConfig(); cfg.heliosToken = token; saveConfig(cfg); }

function showQuickScore() {
  var lb = loadLeaderboard();
  if (!lb.ranked||lb.ranked.length===0) { info('  ○ No scan data yet. Run `chode scan`.'); return; }
  var top = lb.ranked[0];
  var icon = top.score >= 70 ? '✓' : (top.score >= 40 ? '○' : 'x');
  info('  ' + icon + ' Top: ' + top.name + ' (score ' + top.score + ', ' + top.reliability + '% reliable)\n');
}

async function cmdMonitor() {
  info('\n  chode monitor — Background health monitor\n');
  info('  Starting monitor (Ctrl+C to stop)...\n');
  startHealthMonitor();
  
  // Keep process alive
  process.on('SIGINT', function() {
    stopHealthMonitor();
    info('\n  Monitor stopped.\n');
    process.exit(0);
  });
  
  info('  Monitor running. Metrics: .chode/monitor/metrics.json\n');
  info('  Commands: chode costs | chode metrics | chode queue\n');
  
  // Keep alive
  await new Promise(function() {});
}

async function cmdCosts() {
  var report = getCostReport();
  info('\n  Cost Report — ' + report.day + '\n');
  info('  Total: $' + report.totalCost + '\n');
  if (Object.keys(report.providers).length === 0) {
    info('  No costs tracked yet.\n');
    return;
  }
  info('\n  By Provider:\n');
  for (var pid in report.providers) {
    var p = report.providers[pid];
    info('    ' + pid.padEnd(15) + p.requests + ' reqs  ' + p.tokens + ' tokens  $' + p.cost.toFixed(4) + '\n');
  }
}

async function cmdMetrics() {
  var metrics = exportMetrics();
  info('\n  Metrics Export\n');
  info('  Uptime: ' + Math.round(process.uptime()) + 's\n');
  info('  Queue: ' + metrics.queueSize + ' pending\n');
  info('  Costs: $' + (metrics.costs.total || '0') + '\n');
  info('\n  Provider Health:\n');
  for (var i = 0; i < metrics.providers.length; i++) {
    var p = metrics.providers[i];
    var icon = p.circuitState === 'open' ? '✗' : (p.errors > 0 ? '○' : '✓');
    info('    ' + icon + ' ' + p.id.padEnd(15) + p.requests + 'req  ' + p.tokens + 'tok  ' + p.errors + 'err  [' + p.circuitState + ']\n');
  }
  info('\n  Full metrics: .chode/monitor/metrics.json\n');
}

async function cmdQueue() {
  var q = loadQueue();
  info('\n  Request Queue\n');
  info('  Pending: ' + q.requests.length + '/' + QUEUE_MAX_SIZE + '\n');
  if (q.requests.length === 0) {
    info('  Queue empty.\n');
    return;
  }
  info('\n  Recent requests:\n');
  for (var i = Math.max(0, q.requests.length - 5); i < q.requests.length; i++) {
    var r = q.requests[i];
    info('    [' + i + '] ' + r.prompt.slice(0, 50) + '...\n');
  }
}

function cmdDeps(action, projectArg) {
  action = action || 'check';
  info('\n  chode deps — ' + action + '\n');
  var missing = [];
  for (var name in GLOBAL_DEPS) {
    var dep = GLOBAL_DEPS[name];
    var ok = false, status = 'not found';
    if (dep.check) { ok = dep.check(); status = ok ? 'ok' : 'MISSING'; }
    else if (dep.cmd) { try { execSync(dep.cmd, {stdio:'pipe'}); ok = true; status = 'ok'; } catch(e) { status = 'MISSING'; } }
    if (!ok && dep.required) missing.push(name);
    var icon = ok ? '✓' : '✗';
    say('  ' + icon + ' ' + dep.name, ok?'green':'red');
    info('  ' + status + '\n','dim');
  }
  if (action === 'install' || action === 'fix') {
    info('\n  Installing missing dependencies...\n');
    missing.forEach(function(n) { info('  Installing ' + GLOBAL_DEPS[n].name + '...'); try { run('npm install -g ' + GLOBAL_DEPS[n].npm); ok(GLOBAL_DEPS[n].name + ' installed'); } catch(e) { warn(e.message.split('\n')[0]); } });
  }
  if (missing.length === 0) ok('All dependencies healthy\n');
  else info('\n  Commands: chode deps install | update\n');
}

function cmdHelp() {
  info(`
  chode — The Self-Healing Coding Harness
  Free tiers. HEMO auto-provisioning. Zero lock-in.

  AI (routes to best free-tier provider, NEVER STOPS):
    chode ai "prompt"             One-shot with parallel fallback
    chode ai --resume             Resume interrupted session
    chode ai --force <provider>   Force specific provider
    chode project "<spec>"        Multi-step project orchestration
    chode project --resume <id>   Resume interrupted project

  Health & Discovery:
    chode status                  Full health dashboard
    chode scan                    Probe ALL providers, build leaderboard
    chode score                   Show current rankings
    chode heal                    Force full re-scan (clear circuit breakers)

  Keys & Provisioning:
    chode auth                    View/set API keys
    chode provision               Auto-request free-tier keys via HEMO mail
    chode quickkey <provider>     Show signup link and instructions
    chode models                  List all registered providers

  Project Management:
    chode new <name>              Scaffold a Cloudflare Worker
    chode new <name> --skill      Scaffold a HEMO skill
    chode deps [check|install]    Dependency management
    chode session [list|show|reset] Manage sessions
    chode agents [list|add|run]   Spawn subagents on remote/local machines

  Other:
    chode monitor                 Background health monitor (every 30s)
    chode costs                   Show cost tracking report
    chode metrics                 Export system metrics
    chode queue                   Show request queue status
    chode update                  Check for chode updates
    chode init                    One-time setup
  `);
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

var args = process.argv.slice(2);
var cmd = args[0];
var flags = {};
for(var i=0;i<args.length;i++){if(args[i].indexOf('--')===0){var parts=args[i].slice(2).split('=');flags[parts[0]]=parts[1]!==undefined?parts[1]:true;}}

var dispatch = {
  init:       cmdInit,
  new:        function(){cmdNew(args[1],flags);},
  scan:       function(){(async function(){await cmdScan();})();},
  score:      cmdScore,
  ai:         function(){(async function(){await cmdAI(args.slice(1));})();},
  project:    function(){(async function(){var a=args.slice(1);if(a[0]==='--resume'&&a[1])await cmdProjectResume(a[1]);else await cmdProject(a.join(' '));})();},
  heal:       function(){(async function(){await cmdHeal();})();},
  session:    cmdSession,
  auth:       function(){(async function(){await cmdAuth();})();},
  provision:  function(){(async function(){await cmdProvision(args[1]);})();},
  models:     cmdModels,
  status:     cmdStatus,
  deps:       function(){cmdDeps(args[1],args[2]);},
  update:     cmdUpdate,
  help:       cmdHelp,
  agents:     function(){cmdAgents(args[1]);},
  quickkey:   function(){cmdQuickKey(args[1]);},
  monitor:    function(){(async function(){await cmdMonitor();})();},
  costs:      function(){(async function(){await cmdCosts();})();},
  metrics:    function(){(async function(){await cmdMetrics();})();},
  queue:      function(){(async function(){await cmdQueue();})();},
};

if(dispatch[cmd]){dispatch[cmd]();}
else if(cmd){fail('Unknown command: '+cmd);info('  Run `chode help` for usage.');process.exit(1);}
else{(async function(){
  // Startup: greet, then check for keys
  console.log('\n  I\'m OLDGREG\n');
  
  // Start health monitor in background
  startHealthMonitor();
  
  var hasKeys = hasAnyProviderKey();
  if (!hasKeys) {
    info('  No API keys found. Let\'s get you one.\n');
    info('  Pick your path:\n');
    info('    1  Sign up for Groq (fastest, 30 seconds, no credit card)\n');
    info('    2  Sign up for Google Gemini (free, 1,500 requests/day)\n');
    info('    3  Sign up for DeepSeek (generous free tier, no CC)\n');
    info('    4  Use bootstrap fallback (works now, limited)\n');
    info('    5  Skip setup, try anyway\n\n');
    info('  Your choice? (1/2/3/4/5) ');
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', async function(chunk) {
      var choice = chunk.toString().trim();
      if (choice === '1') {
        info('  Opening Groq signup: https://console.groq.com/keys\n');
        info('  After signing up, paste your key:\n');
        process.stdin.once('data', async function(keyChunk) {
          var key = keyChunk.toString().trim();
          if (key) {
            var cfg = loadConfig();
            cfg.providers = cfg.providers || {};
            cfg.providers.groq = { key: key };
            saveConfig(cfg);
            ok('Key saved! Starting AI session...\n');
            await cmdAI([]);
          } else {
            fail('No key provided. Run `chode auth groq [key]` to set it.\n');
            process.exit(0);
          }
        });
      } else if (choice === '2') {
        info('  Opening Google AI Studio: https://aistudio.google.com/app/apikey\n');
        info('  After signing up, paste your key:\n');
        process.stdin.once('data', async function(keyChunk) {
          var key = keyChunk.toString().trim();
          if (key) {
            var cfg = loadConfig();
            cfg.providers = cfg.providers || {};
            cfg.providers.google = { key: key };
            saveConfig(cfg);
            ok('Key saved! Starting AI session...\n');
            await cmdAI([]);
          } else {
            fail('No key provided. Run `chode auth google [key]` to set it.\n');
            process.exit(0);
          }
        });
      } else if (choice === '3') {
        info('  Opening DeepSeek signup: https://platform.deepseek.com/\n');
        info('  After signing up, paste your key:\n');
        process.stdin.once('data', async function(keyChunk) {
          var key = keyChunk.toString().trim();
          if (key) {
            var cfg = loadConfig();
            cfg.providers = cfg.providers || {};
            cfg.providers.deepseek = { key: key };
            saveConfig(cfg);
            ok('Key saved! Starting AI session...\n');
            await cmdAI([]);
          } else {
            fail('No key provided. Run `chode auth deepseek [key]` to set it.\n');
            process.exit(0);
          }
        });
      } else if (choice === '4') {
        info('  Using bootstrap fallback (Pollinations). It works now but is rate-limited.\n');
        info('  For better results, run: chode provision\n\n');
        await cmdAI([]);
      } else if (choice === '5') {
        info('  Starting without keys. Some providers won\'t work.\n');
        info('  To fix: chode auth groq [your-key]\n\n');
        await cmdAI([]);
      }
    });
  } else {
    await cmdAI([]);
  }
  info('\n  Monitor running. Commands: chode metrics | chode costs | chode queue\n');
})();}

function hasAnyProviderKey() {
  var cfg = loadConfig();
  var providers = cfg.providers || {};
  for (var pid in providers) {
    if (providers[pid].key && providers[pid].key.length > 5) return true;
  }
  return false;
}

// ─── Subagent System ───────────────────────────────────────────────────────────
// OLDGREG can spawn subagents on remote servers or local machines

function loadAgents() {
  try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); }
  catch { return { agents: [], tasks: [] }; }
}
function saveAgents(agents) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf8');
}

function spawnAgent(agentId, task) {
  var agents = loadAgents();
  var agent = agents.agents.find(function(a) { return a.id === agentId; });
  if (!agent) throw new Error('Unknown agent: ' + agentId);
  
  var taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var taskRecord = {
    id: taskId,
    agentId: agentId,
    task: task,
    status: 'pending',
    created: new Date().toISOString(),
    result: null,
    error: null
  };
  
  fs.mkdirSync(TASKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TASKS_DIR, taskId + '.json'), JSON.stringify(taskRecord, null, 2));
  
  if (agent.type === 'local') {
    dispatchLocalAgent(agent, task, taskId);
  } else if (agent.type === 'ssh') {
    dispatchSSHAgent(agent, task, taskId);
  } else if (agent.type === 'http') {
    dispatchHTTPAgent(agent, task, taskId);
  }
  
  return taskRecord;
}

function dispatchLocalAgent(agent, task, taskId) {
  var cmd = agent.command || 'node';
  var args = agent.args || [];
  var env = Object.assign({}, process.env, agent.env || {});
  
  var child = spawn(cmd, args.concat([taskId, task]), {
    cwd: agent.cwd || ROOT,
    env: env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  var output = '';
  var error = '';
  
  child.stdout.on('data', function(data) { output += data.toString(); });
  child.stderr.on('data', function(data) { error += data.toString(); });
  
  child.on('close', function(code) {
    var result = { taskId: taskId, exitCode: code, output: output, error: error, completed: new Date().toISOString() };
    var taskFile = path.join(TASKS_DIR, taskId + '.json');
    try {
      var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
      task.status = code === 0 ? 'completed' : 'failed';
      task.result = result;
      fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
    } catch(e) {}
  });
}

function dispatchSSHAgent(agent, task, taskId) {
  var sshCmd = 'ssh';
  var sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    agent.host,
    agent.command || 'bash',
    '-c', 'cd ' + agent.remoteDir + ' && node ' + agent.scriptPath + ' ' + taskId + ' "' + task.replace(/"/g, '\\"') + '"'
  ];
  
  try {
    var result = execSync(sshCmd + ' ' + sshArgs.join(' '), { encoding: 'utf8', timeout: 60000 });
    var taskFile = path.join(TASKS_DIR, taskId + '.json');
    var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    task.status = 'completed';
    task.result = { output: result, completed: new Date().toISOString() };
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
  } catch(e) {
    var taskFile = path.join(TASKS_DIR, taskId + '.json');
    var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    task.status = 'failed';
    task.error = e.message;
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
  }
}

function dispatchHTTPAgent(agent, task, taskId) {
  var url = 'http://' + agent.host + ':' + (agent.port || 3000) + '/task';
  var body = JSON.stringify({ taskId: taskId, task: task, timestamp: Date.now() });
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (agent.token || '') },
    body: body,
    signal: AbortSignal.timeout(30000)
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var taskFile = path.join(TASKS_DIR, taskId + '.json');
    var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    task.status = data.status || 'completed';
    task.result = data;
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
  })
  .catch(function(e) {
    var taskFile = path.join(TASKS_DIR, taskId + '.json');
    var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    task.status = 'failed';
    task.error = e.message;
    fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
  });
}

async function cmdAgents(subcmd) {
  var agents = loadAgents();
  
  if (subcmd === 'list' || !subcmd) {
    info('\n  Registered Agents:\n');
    if (agents.agents.length === 0) {
      info('  No agents registered.\n');
      info('  Add one: chode agents add <id> --type local --command node\n');
      return;
    }
    for (var i = 0; i < agents.agents.length; i++) {
      var a = agents.agents[i];
      var icon = a.enabled !== false ? '✓' : '○';
      var type = a.type === 'ssh' ? 'SSH' : (a.type === 'http' ? 'HTTP' : 'LOCAL');
      say('  ' + icon + ' ' + a.id.padEnd(12), a.enabled !== false ? 'green' : 'white');
      info('  [' + type + '] ' + (a.host || 'localhost') + (a.command ? ' → ' + a.command : ''), 'dim');
    }
    info('\n  Commands: chode agents add | remove | run | status\n');
  }
  else if (subcmd === 'add') {
    var id = args[2]; // 'linux-server' is at args[2] since args[0]='agents', args[1]='add'
    var type = 'local';
    var command = 'node';
    var host = null;
    var token = null;
    
    for (var j = 3; j < args.length; j++) {
      if (args[j] === '--type' && args[j+1]) { type = args[++j]; }
      else if (args[j] === '--command' && args[j+1]) { command = args[++j]; }
      else if (args[j] === '--host' && args[j+1]) { host = args[++j]; }
      else if (args[j] === '--token' && args[j+1]) { token = args[++j]; }
    }
    
    agents.agents.push({
      id: id,
      type: type,
      command: command,
      host: host,
      token: token,
      enabled: true,
      created: new Date().toISOString()
    });
    saveAgents(agents);
    ok('Agent added: ' + id + ' (' + type + ')');
  }
  else if (subcmd === 'remove') {
    var id = args[2];
    agents.agents = agents.agents.filter(function(a) { return a.id !== id; });
    saveAgents(agents);
    ok('Agent removed: ' + id);
  }
  else if (subcmd === 'run') {
    var agentId = args[2];
    var taskText = args.slice(3).join(' ');
    if (!taskText) { fail('Usage: chode agents run <agent-id> "task description"'); return; }
    
    info('\n  Dispatching task to ' + agentId + '...\n');
    try {
      var result = spawnAgent(agentId, taskText);
      ok('Task dispatched: ' + result.id);
      info('  Status: chode agents status ' + result.id + '\n');
    } catch(e) {
      fail(e.message);
    }
  }
  else if (subcmd === 'status') {
    var taskId = args[1];
    if (!taskId) {
      info('\n  Recent Tasks:\n');
      var tasks = agents.tasks || [];
      if (tasks.length === 0) { info('  No tasks yet.\n'); return; }
      for (var k = 0; k < tasks.length; k++) {
        var t = tasks[k];
        var statusIcon = t.status === 'completed' ? '✓' : (t.status === 'failed' ? '✗' : '○');
        say('  ' + statusIcon + ' ' + t.id.slice(-8), t.status === 'completed' ? 'green' : (t.status === 'failed' ? 'red' : 'white'));
        info('  ' + t.agentId + ' - ' + t.task.slice(0, 40) + '...', 'dim');
      }
    } else {
      var taskFile = path.join(TASKS_DIR, taskId + '.json');
      try {
        var task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
        info('\n  Task: ' + task.id + '\n');
        info('  Agent: ' + task.agentId + '\n');
        info('  Task: ' + task.task + '\n');
        info('  Status: ' + task.status + '\n');
        if (task.result) info('  Result: ' + task.result.output?.slice(0, 200) + '\n');
        if (task.error) info('  Error: ' + task.error + '\n');
      } catch(e) {
        fail('Task not found: ' + taskId);
      }
    }
  }
}
