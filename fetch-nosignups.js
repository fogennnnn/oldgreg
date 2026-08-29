const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { 'User-Agent': 'chode/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  const result = await fetch('https://raw.githubusercontent.com/BraveOPotato/FckSignups/main/tools.json');
  const data = JSON.parse(result.body);
  
  console.log('=== AI/LLM Specific Tools ===\n');
  
  // Find LLM/AI tools
  const llmTools = data.tools.filter(t => 
    (t.name?.toLowerCase().includes('llm') || 
     t.name?.toLowerCase().includes('webgl') ||
     t.name?.toLowerCase().includes('webgpu') ||
     t.name?.toLowerCase().includes('sipp') ||
     t.name?.toLowerCase().includes('mermaid') ||
     t.description?.toLowerCase().includes('llm') ||
     t.description?.toLowerCase().includes('inference') ||
     t.description?.toLowerCase().includes('machine learning') ||
     t.description?.toLowerCase().includes('neural'))
  );
  
  for (const tool of llmTools) {
    console.log('🔹', tool.name);
    console.log('   URL:', tool.url);
    console.log('   Category:', tool.category);
    console.log('   Description:', tool.description);
    console.log('');
  }
  
  // Also show all tools with AI in description
  console.log('\n=== Tools with AI in description ===\n');
  const aiDescTools = data.tools.filter(t => 
    t.description?.toLowerCase().includes('ai') ||
    t.description?.toLowerCase().includes('chatgpt') ||
    t.description?.toLowerCase().includes('gpt') ||
    t.description?.toLowerCase().includes('claude') ||
    t.description?.toLowerCase().includes('gemini')
  );
  
  for (const tool of aiDescTools.slice(0, 20)) {
    console.log('🔹', tool.name);
    console.log('   URL:', tool.url);
    console.log('   ', tool.description?.slice(0, 100));
    console.log('');
  }
})();
