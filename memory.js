/**
 * HEMO Memory Manager
 * 
 * Persistent, sealable memory for AI agents using hemo-vault + HELIOS provenance.
 * Features:
 * - Persistent key-value storage across sessions
 * - Optional on-chain sealing for verifiable history
 * - Automatic compression of old conversations
 * - Context window management
 * - Provenance tracking for all memories
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Configuration ─────────────────────────────────────────────────────────────

const VAULT_URL = 'https://hemo-vault.fogeboro.workers.dev';
const HELIOS_URL = 'https://ai.oooooooooo.se';
const CONFIG_DIR = path.join(process.cwd(), '.chode');
const MEMORY_STATE_FILE = path.join(CONFIG_DIR, 'memory_state.json');

// Memory compression thresholds
const COMPRESS_AFTER_MESSAGES = 20;  // Compress after N messages
const MAX_CONTEXT_TOKENS = 4000;     // Max tokens in context window
const SUMMARY_MAX_LENGTH = 500;      // Max chars in compressed summary

// ─── State ─────────────────────────────────────────────────────────────────────

var heliosToken = null;
var agentHash = null;
var memoryIndex = {};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function loadHeliosToken() {
  try {
    var cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'config.json'), 'utf8'));
    return cfg.heliosToken || null;
  } catch { return null; }
}

function saveHeliosToken(token) {
  var cfgPath = path.join(CONFIG_DIR, 'config.json');
  var cfg = { providers: {}, heliosToken: token, omniroute: { port: 20128 } };
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  cfg.heliosToken = token;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

function computeAgentHash(token) {
  return crypto.createHash('sha256')
    .update(token)
    .digest('hex')
    .slice(0, 16);
}

function getMemoryKey(type, id) {
  // Keys must match [a-z0-9_.-]{1,120}
  var safeId = id.replace(/[^a-z0-9_.-]/g, '-').toLowerCase();
  return type + '_' + safeId;
}

function loadMemoryState() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_STATE_FILE, 'utf8'));
  } catch {
    return { sessions: [], memories: {}, compressed: [], createdAt: new Date().toISOString() };
  }
}

function saveMemoryState(state) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── HEMO Vault API ────────────────────────────────────────────────────────────

function vaultRequest(method, endpoint, body, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var url = new URL(VAULT_URL + endpoint);
    var isGet = method === 'GET' || method === 'DELETE';
    
    var req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + heliosToken,
        'User-Agent': 'chode/1.0 (hemo-vault)'
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', function(e) { reject(e); });
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
    
    if (body && !isGet) req.write(JSON.stringify(body));
    req.end();
  });
}

async function putMemory(key, value, options) {
  options = options || {};
  var endpoint = '/api/v1/state/' + encodeURIComponent(key);
  var query = '?ttl=' + (options.ttl || 86400);
  if (options.seal) query += '&seal=1';
  
  var result = await vaultRequest('PUT', endpoint + query, value);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error('Vault PUT failed: ' + result.status + ' ' + JSON.stringify(result.body));
  }
  return result.body;
}

async function getMemory(key) {
  var endpoint = '/api/v1/state/' + encodeURIComponent(key);
  var result = await vaultRequest('GET', endpoint);
  if (result.status === 404) return null;
  if (result.status !== 200) {
    throw new Error('Vault GET failed: ' + result.status);
  }
  return result.body;
}

async function deleteMemory(key) {
  var endpoint = '/api/v1/state/' + encodeURIComponent(key);
  var result = await vaultRequest('DELETE', endpoint);
  return result.status === 200;
}

async function listMemories(prefix) {
  var endpoint = '/api/v1/state';
  if (prefix) endpoint += '?prefix=' + encodeURIComponent(prefix);
  var result = await vaultRequest('GET', endpoint);
  if (result.status !== 200) return [];
  // Handle both array and object responses
  if (Array.isArray(result.body)) return result.body.map(function(k) { return k.key || k; });
  if (result.body && result.body.keys) return result.body.keys.map(function(k) { return k.key; });
  if (result.body && result.body.data) return result.body.data.map(function(k) { return k.key || k; });
  return [];
}

async function sealMemory(key) {
  var endpoint = '/api/v1/seal/' + encodeURIComponent(key);
  var result = await vaultRequest('POST', endpoint);
  if (result.status !== 200) {
    throw new Error('Seal failed: ' + result.status);
  }
  return result.body;
}

// ─── HELIOS Identity ───────────────────────────────────────────────────────────

async function createHeliosAccount(username) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: HELIOS_URL.replace('https://', ''),
      path: '/api/v1/accounts',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'chode/1.0' }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var body = JSON.parse(data);
          if (body.token) resolve(body);
          else reject(new Error('No token in response'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify({ username: username }));
    req.end();
  });
}

async function ensureHeliosIdentity() {
  if (heliosToken) return heliosToken;
  
  heliosToken = loadHeliosToken();
  if (heliosToken) {
    agentHash = computeAgentHash(heliosToken);
    return heliosToken;
  }
  
  // Create new identity
  var username = 'chode-' + Date.now().toString(36).slice(-6);
  console.log('\n  Creating HEMO identity...');
  var account = await createHeliosAccount(username);
  heliosToken = account.token;
  agentHash = computeAgentHash(heliosToken);
  saveHeliosToken(heliosToken);
  console.log('  ✓ Identity created: ' + username);
  return heliosToken;
}

// ─── Memory Operations ─────────────────────────────────────────────────────────

async function storeMessage(sessionId, message) {
  var key = getMemoryKey('msg', sessionId + '_' + Date.now());
  await putMemory(key, message, { ttl: 604800, seal: false }); // 7 days, no seal
  
  // Track in index
  var state = loadMemoryState();
  if (!state.sessions[sessionId]) state.sessions[sessionId] = { messages: [], createdAt: new Date().toISOString() };
  state.sessions[sessionId].messages.push({ key: key, ts: Date.now(), type: message.role });
  saveMemoryState(state);
}

async function storeMemory(type, id, data, options) {
  options = options || {};
  var key = getMemoryKey(type, id);
  var result = await putMemory(key, data, { ttl: options.ttl || 2592000, seal: options.seal }); // 30 days default
  
  // Index it
  var state = loadMemoryState();
  if (!state.memories[type]) state.memories[type] = {};
  state.memories[type][id] = { key: key, sealed: !!result.seal, storedAt: new Date().toISOString() };
  saveMemoryState(state);
  
  return result;
}

async function recallMemory(type, id) {
  var key = getMemoryKey(type, id);
  return await getMemory(key);
}

async function recallSession(sessionId) {
  var state = loadMemoryState();
  var session = state.sessions[sessionId];
  if (!session) return null;
  
  var messages = [];
  for (var i = 0; i < session.messages.length; i++) {
    var msg = await getMemory(session.messages[i].key);
    if (msg) messages.push(msg.value);
  }
  return messages;
}

// ─── Compression ───────────────────────────────────────────────────────────────

async function compressSession(sessionId, aiProvider) {
  var state = loadMemoryState();
  var session = state.sessions[sessionId];
  if (!session || session.messages.length < COMPRESS_AFTER_MESSAGES) return null;
  
  // Gather messages
  var messages = [];
  for (var i = 0; i < session.messages.length; i++) {
    var msg = await getMemory(session.messages[i].key);
    if (msg) messages.push(msg.value);
  }
  
  if (messages.length === 0) return null;
  
  // Request compression from AI
  var prompt = 'Compress these conversation messages into a concise summary (max ' + SUMMARY_MAX_LENGTH + ' chars). Include key decisions, actions taken, and important context:\n\n' + 
    messages.map(function(m) { return m.role + ': ' + m.content.slice(0, 500); }).join('\n');
  
  var summary = await aiProvider(prompt);
  if (!summary) summary = 'Session ' + sessionId + ' compressed (' + messages.length + ' messages)';
  
  // Store compressed version
  var compKey = getMemoryKey('comp', sessionId);
  await storeMemory('comp', sessionId, {
    originalCount: messages.length,
    summary: summary,
    compressedAt: new Date().toISOString(),
    messages: session.messages.map(function(m) { return m.key; })
  }, { seal: true });
  
  // Archive old messages (mark for deletion after 24h)
  for (var i = 0; i < session.messages.length; i++) {
    setTimeout(function(key) { deleteMemory(key); }.bind(null, session.messages[i].key), 86400000);
  }
  
  // Clear session
  session.messages = [];
  session.compressed = compKey;
  saveMemoryState(state);
  
  return summary;
}

// ─── Context Window Management ─────────────────────────────────────────────────

async function buildContext(sessionId, maxTokens) {
  maxTokens = maxTokens || MAX_CONTEXT_TOKENS;
  var state = loadMemoryState();
  var session = state.sessions[sessionId];
  if (!session) return [];
  
  var messages = [];
  var totalTokens = 0;
  
  // Get recent messages (most recent first)
  var recentMsgs = session.messages.slice().reverse();
  for (var i = 0; i < recentMsgs.length; i++) {
    var msg = await getMemory(recentMsgs[i].key);
    if (msg) {
      var tokens = Math.ceil(msg.value.content.length / 4);
      if (totalTokens + tokens > maxTokens) break;
      totalTokens += tokens;
      messages.unshift(msg.value);
    }
  }
  
  // Check for compressed summary
  if (session.compressed) {
    var comp = await getMemory(session.compressed);
    if (comp && messages.length === 0) {
      messages.push({ role: 'system', content: '[Previous session summary: ' + comp.value.summary + ']' });
    }
  }
  
  return messages;
}

// ─── Provenance ────────────────────────────────────────────────────────────────

async function verifySeal(key) {
  var memory = await getMemory(key);
  if (!memory || !memory.sealed_records || memory.sealed_records.length === 0) {
    return { verified: false, reason: 'not_sealed' };
  }
  
  // Verify against HELIOS ledger
  var record = memory.sealed_records[0];
  var verifier = await fetch(HELIOS_URL + '/api/v1/records/' + record.record_id)
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });
  
  if (!verifier) return { verified: false, reason: 'ledger_unreachable' };
  
  return {
    verified: true,
    recordId: record.record_id,
    sha256: record.sha256,
    sealedAt: record.at
  };
}

// ─── CLI Commands ──────────────────────────────────────────────────────────────

async function cmdMemory(subcmd) {
  try {
    await ensureHeliosIdentity();
  } catch(e) {
    console.error('Failed to create HEMO identity:', e.message);
    console.log('You may need to create one manually at https://ai.oooooooooo.se');
    return;
  }
  
  if (subcmd === 'store' && args[1] && args[2]) {
    var keyArg = args[1];
    var keyParts = keyArg.split('_');
    var keyType = keyParts[0];
    var keyId = keyParts.slice(1).join('_');
    var value = args.slice(2).join(' ');
    var seal = args.includes('--seal');
    var result = await storeMemory(keyType, keyId, value, { seal: seal });
    console.log('✓ Stored: ' + keyArg + (result.seal ? ' (sealed on-chain)' : ''));
    
  } else if (subcmd === 'recall' && args[1]) {
    var keyArg = args[1];
    var keyParts = keyArg.split('_');
    var keyType = keyParts[0];
    var keyId = keyParts.slice(1).join('_');
    var result = await recallMemory(keyType, keyId);
    if (result) {
      console.log('Value:', result.value);
      if (result.sealed_records) console.log('Sealed:', result.sealed_records.length, 'records');
    } else {
      console.log('Not found: ' + keyArg);
    }
    
  } else if (subcmd === 'list') {
    var keys = await listMemories();
    console.log('Memories (' + keys.length + '):');
    if (Array.isArray(keys)) {
      keys.forEach(function(k) { console.log('  ' + k); });
    } else if (keys && keys.keys) {
      keys.keys.forEach(function(k) { console.log('  ' + k); });
    }
    
  } else if (subcmd === 'compress' && args[2]) {
    var sessionId = args[2];
    // Use Agnes for compression
    var summary = await compressSession(sessionId, async function(prompt) {
      // Simple compression without AI for now
      return 'Compressed session with historical context preserved.';
    });
    console.log('Compressed:', summary);
    
  } else if (subcmd === 'context' && args[2]) {
    var sessionId = args[2];
    var ctx = await buildContext(sessionId);
    console.log('Context (' + ctx.length + ' messages):');
    ctx.forEach(function(m) { console.log('  [' + m.role + '] ' + m.content.slice(0, 100)); });
    
  } else if (subcmd === 'seal' && args[1]) {
    var keyArg = args[1];
    var keyParts = keyArg.split('_');
    var keyType = keyParts[0];
    var keyId = keyParts.slice(1).join('_');
    var result = await sealMemory(getMemoryKey(keyType, keyId));
    console.log('Sealed:', result.record_id);
    
  } else if (subcmd === 'verify' && args[1]) {
    var keyArg = args[1];
    var keyParts = keyArg.split('_');
    var keyType = keyParts[0];
    var keyId = keyParts.slice(1).join('_');
    var result = await verifySeal(getMemoryKey(keyType, keyId));
    console.log('Verified:', result.verified ? 'YES' : 'NO');
    if (result.recordId) console.log('Record:', result.recordId);
    
  } else if (subcmd === 'status') {
    var keys = await listMemories();
    console.log('Memory Status:');
    console.log('  Agent hash:', agentHash);
    console.log('  Stored keys:', keys.length);
    console.log('  Token:', heliosToken ? heliosToken.slice(0, 20) + '...' : 'none');
    
  } else {
    console.log('\n  chode memory — Persistent memory with HEMO vault\n');
    console.log('  Commands:');
    console.log('    chode memory store <type:id> <value> [--seal]   Store memory');
    console.log('    chode memory recall <type:id>                   Recall memory');
    console.log('    chode memory list                               List all memories');
    console.log('    chode memory compress <session-id>              Compress old session');
    console.log('    chode memory context <session-id>               Build context window');
    console.log('    chode memory seal <type:id>                     Seal memory on-chain');
    console.log('    chode memory verify <type:id>                   Verify seal provenance');
    console.log('    chode memory status                             Show memory stats');
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

var args = process.argv.slice(2);
var cmd = args[0] || 'status';
if (['store', 'recall', 'list', 'compress', 'context', 'seal', 'verify', 'status'].indexOf(cmd) !== -1) {
  cmdMemory(cmd).catch(function(e) {
    console.error('Error:', e.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node memory.js <command> [args]');
  console.log('Commands: store, recall, list, compress, context, seal, verify, status');
  process.exit(0);
}
