const https = require('https');
const http = require('http');

// Test WebLLM API
async function testWebLLM() {
  return new Promise((resolve) => {
    const req = https.request('https://webllm.mlc.ai/', {
      method: 'GET',
      headers: { 'User-Agent': 'chode/1.0' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('WebLLM Status:', res.statusCode);
        // Look for API endpoints in the page
        const apiMatches = d.match(/api|fetch|model|llm|chat/gi);
        console.log('API-related terms found:', apiMatches?.length || 0);
        resolve();
      });
    });
    req.on('error', e => console.log('WebLLM ERR:', e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// Test Sipp Chat
async function testSipp() {
  return new Promise((resolve) => {
    const req = https.request('https://chat.sipp.sh/', {
      method: 'GET',
      headers: { 'User-Agent': 'chode/1.0' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Sipp Status:', res.statusCode);
        const apiMatches = d.match(/api|fetch|model|llm|chat|websocket|wss/gi);
        console.log('API-related terms found:', apiMatches?.length || 0);
        resolve();
      });
    });
    req.on('error', e => console.log('Sipp ERR:', e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// Test ClearCanvas AI
async function testClearCanvas() {
  return new Promise((resolve) => {
    const req = https.request('https://clearcanvasai.vercel.app/', {
      method: 'GET',
      headers: { 'User-Agent': 'chode/1.0' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('ClearCanvas Status:', res.statusCode);
        const apiMatches = d.match(/api|fetch|model|llm|chat|image|generate/gi);
        console.log('API-related terms found:', apiMatches?.length || 0);
        resolve();
      });
    });
    req.on('error', e => console.log('ClearCanvas ERR:', e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// Test CodeMap AI
async function testCodeMap() {
  return new Promise((resolve) => {
    const req = https.request('https://code-map-ai-mu.vercel.app/', {
      method: 'GET',
      headers: { 'User-Agent': 'chode/1.0' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('CodeMap Status:', res.statusCode);
        const apiMatches = d.match(/api|fetch|model|llm|chat|code|graph/gi);
        console.log('API-related terms found:', apiMatches?.length || 0);
        resolve();
      });
    });
    req.on('error', e => console.log('CodeMap ERR:', e.message));
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

(async () => {
  console.log('=== Testing NoSignups AI Tools ===\n');
  await testWebLLM();
  console.log('');
  await testSipp();
  console.log('');
  await testClearCanvas();
  console.log('');
  await testCodeMap();
})();
