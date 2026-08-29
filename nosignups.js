/**
 * NoSignups Integration
 * 
 * Fetches and caches tools from https://nosignups.net
 * Provides no-signup AI/LLM tools for offline use
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_FILE = path.join(process.cwd(), '.oldgreg', 'nosignups-cache.json');
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// No-signup AI tools from NoSignups
const NO_SIGNUP_TOOLS = {
  webllm: {
    name: 'WebLLM',
    url: 'https://webllm.mlc.ai/',
    description: 'High-performance In-browser LLM Inference Engine',
    category: 'productivity',
    type: 'llm',
    noSignup: true,
    openSource: true
  },
  sipp: {
    name: 'Sipp Chat',
    url: 'https://chat.sipp.sh/',
    description: 'AI inference, packed simply. A blazing-fast, zero-dependency WebGPU runtime',
    category: 'productivity',
    type: 'llm',
    noSignup: true,
    openSource: true
  },
  clearcanvas: {
    name: 'ClearCanvas AI',
    url: 'https://clearcanvasai.vercel.app/',
    description: 'Generate images, compress photos, upscale pictures, and remove backgrounds',
    category: 'media',
    type: 'image',
    noSignup: true,
    openSource: false
  },
  codemap: {
    name: 'CodeMap AI',
    url: 'https://code-map-ai-mu.vercel.app/',
    description: 'Helps developers understand large repositories with AI',
    category: 'development',
    type: 'code',
    noSignup: true,
    openSource: false
  },
  editorpilot: {
    name: 'EditorPilot',
    url: 'https://editorpilot.com/',
    description: 'AI writing assistant that lives entirely in your browser',
    category: 'productivity',
    type: 'writing',
    noSignup: true,
    openSource: false
  },
  mermify: {
    name: 'Mermify',
    url: 'https://tra-sco.github.io/mermify/',
    description: 'Bi-directional visual editor for Mermaid.js flowcharts',
    category: 'development',
    type: 'diagram',
    noSignup: true,
    openSource: true
  }
};

// Prompt engineering techniques from Prompt Engineering Guide
const PROMPT_TECHNIQUES = {
  zeroshot: {
    name: 'Zero-Shot Prompting',
    description: 'Ask the model to perform a task without any examples',
    template: 'Please [TASK].\n\n[CONTEXT]',
    example: 'Please translate the following text to French.\n\nHello, how are you?'
  },
  fewshot: {
    name: 'Few-Shot Prompting',
    description: 'Provide a few examples before the task',
    template: 'Example 1:\nInput: [INPUT_1]\nOutput: [OUTPUT_1]\n\nExample 2:\nInput: [INPUT_2]\nOutput: [OUTPUT_2]\n\nNow do this:\nInput: [INPUT_3]\nOutput:',
    example: 'Convert camelCase to snake_case:\n\ncamelCase -> camel_case\nhelloWorld -> hello_world\n\nWhat is the result of: firstName?'
  },
  cot: {
    name: 'Chain-of-Thought',
    description: 'Ask the model to think step by step',
    template: 'Let\'s think step by step.\n\n[QUESTION]',
    example: 'Let\'s think step by step.\n\nI have 5 apples. I eat 2. How many do I have left?'
  },
  self_consistency: {
    name: 'Self-Consistency',
    description: 'Generate multiple reasoning paths and pick the most consistent answer',
    template: 'Generate 3 different ways to solve: [QUESTION]\n\nThen pick the most consistent answer.',
    example: 'Generate 3 different ways to solve: What is 15% of 200?\n\nThen pick the most consistent answer.'
  },
  prompt_chaining: {
    name: 'Prompt Chaining',
    description: 'Break complex tasks into a chain of simpler prompts',
    template: 'Step 1: [SUBTASK_1]\nStep 2: [SUBTASK_2]\nStep 3: [SUBTASK_3]',
    example: 'Step 1: Extract key points from this article.\nStep 2: Summarize each key point.\nStep 3: Combine into a final summary.'
  },
  tot: {
    name: 'Tree of Thoughts',
    description: 'Explore multiple reasoning paths like a tree',
    template: 'Think about [PROBLEM].\nConsider 3 different approaches:\n1. [APPROACH_1]\n2. [APPROACH_2]\n3. [APPROACH_3]\nWhich is best and why?',
    example: 'Think about optimizing this code.\nConsider 3 different approaches:\n1. Reduce loop iterations\n2. Use memoization\n3. Parallelize work\nWhich is best and why?'
  },
  rag: {
    name: 'Retrieval Augmented Generation',
    description: 'Combine external knowledge with LLM generation',
    template: 'Context:\n[PASSED_CONTEXT]\n\nQuestion: [QUESTION]\n\nAnswer using only the context above.',
    example: 'Context:\nThe capital of France is Paris. The population is approximately 2.1 million.\n\nQuestion: What is the population of France\'s capital?\n\nAnswer using only the context above.'
  },
  react: {
    name: 'ReAct Prompting',
    description: 'Reason and Act in an interleaved manner',
    template: 'Question: [QUESTION]\n\nThought: [REASONING]\nAction: [ACTION]\nObservation: [RESULT]\n...\nFinal Answer: [ANSWER]',
    example: 'Question: What is the weather in Tokyo?\n\nThought: I need to search for current weather in Tokyo.\nAction: search("Tokyo weather")\nObservation: {"temperature": "22°C", "condition": "Sunny"}\nFinal Answer: It\'s 22°C and sunny in Tokyo.'
  },
  pal: {
    name: 'Program-Aided Language Models',
    description: 'Use code to verify mathematical reasoning',
    template: '[MATH_PROBLEM]\n\nLet\'s write code to solve this:\n```python\n# Your code here\n```\n\nRunning the code gives us: [RESULT]',
    example: 'What is the factorial of 5?\n\nLet\'s write code to solve this:\n```python\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(5))\n```\n\nRunning the code gives us: 120'
  }
};

// Prompt engineering tips
const PROMPT_TIPS = [
  'Be specific and clear about what you want',
  'Provide context and background information',
  'Use examples (few-shot prompting) for complex tasks',
  'Ask the model to think step by step (chain-of-thought)',
  'Break complex tasks into smaller sub-tasks',
  'Specify the format you want the output in',
  'Use role-playing: "You are an expert [ROLE]..."',
  'Give the model time to "think" before answering',
  'Provide constraints to narrow the search space',
  'Use positive framing: "Do this" instead of "Don\'t do that"'
];

// --- Functions ---

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (data.fetchedAt && Date.now() - data.fetchedAt < REFRESH_INTERVAL) {
      return data;
    }
  } catch (e) {}
  return null;
}

function saveCache(data) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({
    ...data,
    fetchedAt: Date.now()
  }));
}

async function fetchNoSignups() {
  return new Promise((resolve, reject) => {
    https.get('https://raw.githubusercontent.com/BraveOPotato/FckSignups/main/tools.json', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getTools(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) return cached;
  }
  
  try {
    const data = await fetchNoSignups();
    saveCache(data);
    return data;
  } catch (e) {
    console.error('Failed to fetch NoSignups:', e.message);
    return null;
  }
}

function getAITools(toolsData) {
  if (!toolsData || !toolsData.tools) return Object.values(NO_SIGNUP_TOOLS);
  
  const aiKeywords = ['ai', 'llm', 'chat', 'gpt', 'claude', 'gemini', 'ollama', 'stable diffusion', 'image', 'code', 'inference', 'neural', 'machine learning'];
  
  return toolsData.tools.filter(t => 
    aiKeywords.some(k => t.name?.toLowerCase().includes(k) || t.description?.toLowerCase().includes(k))
  ).slice(0, 20);
}

function getPromptTechniques() {
  return PROMPT_TECHNIQUES;
}

function getPromptTips() {
  return PROMPT_TIPS;
}

function formatPromptTechnique(name, technique) {
  return `
${technique.name}
${'═'.repeat(40)}
Description: ${technique.description}

Template:
\`\`\`
${technique.template}
\`\`\`

Example:
\`\`\`
${technique.example}
\`\`\`
`;
}

function formatNoSignupTool(tool) {
  return `
${tool.name}
${'─'.repeat(40)}
URL: ${tool.url}
Category: ${tool.category}
Description: ${tool.description}
No Signup: ${tool.noSignup ? '✓' : '✗'}
Open Source: ${tool.openSource ? '✓' : '✗'}
`;
}

// --- CLI Commands ---

async function cmdNoSignups(subcmd) {
  if (subcmd === 'tools' || !subcmd) {
    console.log('\n📦 NoSignups Tools (No account required)\n');
    console.log('═'.repeat(60));
    
    const toolsData = await getTools();
    const aiTools = getAITools(toolsData);
    
    console.log(`Found ${aiTools.length} AI/LLM tools:\n`);
    
    for (const tool of aiTools) {
      console.log(formatNoSignupTool(tool));
    }
    
    console.log('\n💡 Use these tools directly in your browser - no signup required!');
    
  } else if (subcmd === 'techniques' || subcmd === 'prompts') {
    console.log('\n🧠 Prompt Engineering Techniques\n');
    console.log('═'.repeat(60));
    
    const techniques = getPromptTechniques();
    const names = Object.keys(techniques);
    
    for (const name of names) {
      console.log(formatPromptTechnique(name, techniques[name]));
    }
    
  } else if (subcmd === 'tips') {
    console.log('\n💡 Prompt Engineering Tips\n');
    console.log('═'.repeat(60));
    
    const tips = getPromptTips();
    tips.forEach((tip, i) => {
      console.log(`${i + 1}. ${tip}`);
    });
    
  } else if (subcmd === 'refresh') {
    console.log('\n🔄 Refreshing NoSignups cache...\n');
    const toolsData = await getTools(true);
    if (toolsData) {
      console.log('✓ Cache refreshed!');
      console.log(`  Total tools: ${toolsData.tools?.length || 0}`);
      console.log(`  Categories: ${toolsData.categories?.length || 0}`);
    } else {
      console.log('✗ Failed to refresh cache');
    }
    
  } else if (subcmd === 'help') {
    console.log(`
  oldgreg nosignups — No-signup tools & prompt engineering

  Commands:
    oldgreg nosignups              List AI/LLM tools (no signup required)
    oldgreg nosignups techniques   Show prompt engineering techniques
    oldgreg nosignups tips         Show prompt engineering tips
    oldgreg nosignups refresh      Refresh the tools cache
    oldgreg nosignups help         Show this help
`);
    
  } else {
    console.log('Unknown command: ' + subcmd);
    console.log('Run: oldgreg nosignups help');
  }
}

// Export for use in main script
module.exports = {
  getTools,
  getAITools,
  getPromptTechniques,
  getPromptTips,
  cmdNoSignups
};
