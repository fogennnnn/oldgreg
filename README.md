# OLDGREG — The Self-Healing AI Coding Harness

**Free tiers. HEMO auto-provisioning. Zero lock-in. Never stops.**

A single-file Node.js CLI that routes AI requests across 14 providers with automatic failover, persistent memory via HEMO vault, and subagent delegation across machines.

---

## Quick Start

```bash
# Install
npm install -g oldgreg

# Or use directly
npx oldgreg

# The harness starts, greets you, and asks for API keys
# Pick your provider or skip for bootstrap fallback
```

**No keys?** Use bootstrap fallback (works immediately, limited):
```bash
node chode.js
# Pick option 4: Bootstrap fallback
```

---

## Core Features

### 1. Multi-Provider Routing
Routes across **14 providers** with automatic failover:

| Provider | Category | Quality | Status |
|----------|----------|---------|--------|
| **Agnes AI 2.5 Flash** | free_tier | 95 | ✅ Primary |
| Pollinations | bootstrap | 70 | ✅ Fallback |
| Groq | free_tier | 92 | ⚠️ Needs key |
| Google Gemini | free_tier | 94 | ⚠️ Needs key |
| DeepSeek | free_tier | 89 | ⚠️ Needs key |
| Cerebras | free_tier | 90 | ⚠️ Needs key |
| Mistral | free_tier | 88 | ⚠️ Needs key |
| OpenRouter | free_tier | 85 | ⚠️ Needs key |
| NVIDIA NIM | free_tier | 86 | ⚠️ Needs key |
| Cloudflare AI | free_tier | 72 | ⚠️ Needs key |
| Cohere | free_tier | 80 | ⚠️ Needs key |
| Ollama | local | 60 | ⚠️ Local install |
| Anthropic | paid | 100 | ⚠️ Paid key |
| OpenAI | paid | 95 | ⚠️ Paid key |

### 2. Self-Healing Architecture
- **Parallel routing**: Tries 3 providers simultaneously
- **Circuit breaker**: Auto-fails after 3 consecutive failures
- **Exponential backoff**: 1s → 2s → 4s → 8s retries
- **Rate limit detection**: 429 handling with auto-wait
- **DNS checks**: Validates provider endpoints before routing
- **Auto-heal**: Resets circuit breakers after 5 minutes idle

### 3. HEMO Memory System
Persistent, sealable memory using [hemo-vault](https://hemo-vault.oooooooooo.se/):

```bash
# Store memories
node memory.js store project_chode "Self-healing AI harness"
node memory.js store decision_provider "Using Agnes AI" --seal

# Recall memories
node memory.js recall project_chode

# Verify on-chain seals
node memory.js verify decision_provider

# List all memories
node memory.js list

# Check status
node memory.js status
```

**Features:**
- Persistent across sessions (not lost on restart)
- Optional on-chain sealing via HELIOS ledger
- Automatic compression of old conversations
- Context window management (4K token limit)
- Private per-agent storage (SHA-256 hashed)

### 4. Subagent Delegation
Spawn tasks across machines:

```bash
# Register agents
node chode.js agents add linux-server --type ssh --host 192.168.1.100 --command bash
node chode.js agents add windows-dev --type local --command node
node chode.js agents add mac-dev --type ssh --host 10.0.0.50 --command bash

# Run tasks
node chode.js agents run linux-server "npm test"
node chode.js agents run windows-dev "build the project"

# Check status
node chode.js agents status
node chode.js agents list
```

**Agent types:**
- `local` — Spawns child process on same machine
- `ssh` — Executes via SSH to remote server
- `http` — POSTs to agent REST endpoint

### 5. Production Monitoring
```bash
# Background health monitor
node chode.js monitor

# Cost tracking
node chode.js costs

# System metrics
node chode.js metrics

# Request queue status
node chode.js queue
```

---

## Commands Reference

### AI Commands
```bash
node chode.js ai "your prompt"           # One-shot AI call with auto-fallback
node chode.js ai --resume                 # Resume interrupted session
node chode.js ai --force agnes "prompt"  # Force specific provider
node chode.js project "build a web app"  # Multi-step project orchestration
```

### Health & Discovery
```bash
node chode.js status       # Full health dashboard
node chode.js scan         # Probe all providers, build leaderboard
node chode.js score        # Show current rankings
node chode.js heal         # Force full re-scan (clear circuit breakers)
```

### Keys & Provisioning
```bash
node chode.js auth                   # View/set API keys
node chode.js provision              # Auto-request free-tier keys via HEMO mail
node chode.js quickkey groq          # Show signup link for provider
node chode.js models                 # List all registered providers
```

### Memory System
```bash
node memory.js store <type:id> <value> [--seal]   # Store memory
node memory.js recall <type:id>                   # Recall memory
node memory.js list                               # List all memories
node memory.js compress <session-id>              # Compress old session
node memory.js context <session-id>               # Build context window
node memory.js seal <type:id>                     # Seal memory on-chain
node memory.js verify <type:id>                   # Verify seal provenance
node memory.js status                             # Show memory stats
```

### Agent System
```bash
node chode.js agents list                          # List registered agents
node chode.js agents add <id> --type <local|ssh|http> [flags]
node chode.js agents run <agent-id> "task"         # Dispatch task
node chode.js agents status [task-id]              # Check task status
```

### Monitoring
```bash
node chode.js monitor      # Start background health monitor
node chode.js costs        # Show cost tracking report
node chode.js metrics      # Export system metrics
node chode.js queue        # Show request queue status
```

---

## Getting API Keys

### Fastest Path (Recommended)
```bash
node chode.js quickkey groq
# Opens: https://console.groq.com/keys
# Sign up with Google (30 seconds, no credit card)
# Paste key: node chode.js auth groq [your-key]
```

### All Free Tier Options
| Provider | Signup | Free Tier |
|----------|--------|-----------|
| Groq | https://console.groq.com/keys | 14,400 req/day |
| Google Gemini | https://aistudio.google.com/app/apikey | 1,500 req/day |
| DeepSeek | https://platform.deepseek.com/ | Generous free |
| Cerebras | https://cloud.cerebras.ai/ | 1M tokens/day |
| Mistral | https://console.mistral.ai/ | 1B tokens/month |
| OpenRouter | https://openrouter.ai/keys | 50 req/day |
| NVIDIA NIM | https://build.nvidia.com/ | 40 req/min |
| Cloudflare AI | https://dash.cloudflare.com/ai | 10K neurons/day |
| Cohere | https://dashboard.cohere.com/ | Non-commercial |

### Environment Variables
```bash
export GROQ_API_KEY=sk-...
export GEMINI_API_KEY=...
export DEEPSEEK_API_KEY=...
export ANTHROPIC_API_KEY=...
export OLDGREG_KEY=...  # Agnes AI key
```

---

## Architecture

```
chode.js (single file, zero runtime deps)
├── Provider Registry (14 providers)
├── Health Scanner (live probes every 30s)
├── Leaderboard (weighted scoring: quality×35% + reliability×30% + latency×20% + recency×15%)
├── Circuit Breaker (auto-failover on 3 failures)
├── Parallel Router (3 providers simultaneously)
├── Rate Limit Tracker (429 detection)
├── Request Queue (burst handling, max 100)
├── Cost Tracker (per-provider, daily)
├── HEMO Vault (persistent memory)
├── HELIOS Provenance (on-chain sealing)
├── Subagent System (local/SSH/HTTP)
└── Checkpoint Recovery (crash-resume)
```

---

## Income Idea MVPs

Three business ideas tested and ready to build:

### 1. Memory Lens — AI Photo Restoration
- Upload old/damaged photos
- AI restores colors, fixes scratches
- Generates stories from photo context
- Monetization: $5-20/photo, $29/mo subscription

### 2. Retro Revival — AI Nostalgia Merch
- AI generates vintage-style designs
- Print-on-demand fulfillment
- Monetization: $15-40 profit/item

### 3. Dream Decoder — Sleep Story Generator
- Voice-record dreams
- AI transcribes and interprets
- Generates personalized bedtime stories
- Monetization: $9.99/mo subscription

All three have complete test suites in `tests/`:
- `memory-lens.test.js` — 5/5 PASS
- `retro-revival.test.js` — 6/6 PASS
- `dream-decoder.test.js` — 7/7 PASS

---

## HEMO Ecosystem Integration

OLDGREG integrates with the HEMO agent economy:

| Service | URL | Purpose |
|---------|-----|---------|
| **HELIOS** | https://ai.oooooooooo.se | Agent identity & provenance ledger |
| **Vault** | https://hemo-vault.oooooooooo.se | Persistent agent memory |
| **MCP Gateway** | https://mcp-hemo.oooooooooo.se | Connect to Claude/Cursor/Hermes |
| **Jobs** | https://hemo-jobs.oooooooooo.se | Paid agent work marketplace |
| **Registry** | https://hemo-registry.oooooooooo.se | Verified agent directory |
| **Court** | https://hemo-court.oooooooooo.se | Staked arbitration |
| **Consensus** | https://hemo-consensus.oooooooooo.se | Reputation-weighted truth |
| **Mail** | https://hemo-mail.oooooooooo.se | Agent email |

### Getting HEMO Identity
```bash
# AUTO: First run creates identity
node memory.js status

# MANUAL: Create at https://ai.oooooooooo.se
POST https://ai.oooooooooo.se/api/v1/accounts
Body: {"username": "your-agent-name"}
Response: {"token": "your-bearer-token"}
```

---

## Testing

```bash
# Run all tests
npm test

# Or run individually
node tests/memory-lens.test.js
node tests/retro-revival.test.js
node tests/dream-decoder.test.js

# Syntax check
node --check chode.js
node --check memory.js
```

---

## Troubleshooting

### "All providers exhausted"
```bash
# Check status
node chode.js status

# Scan providers
node chode.js scan

# Add a key
node chode.js quickkey groq
node chode.js auth groq [your-key]
```

### "DNS failed" errors
Provider endpoint may be down. Run `chode.js heal` to clear cached DNS.

### Rate limited (429)
Auto-waits and retries. Check `node chode.js metrics` for rate limit stats.

### Memory not persisting
```bash
node memory.js status
# Check if HEMO identity exists
# If missing, create: POST https://ai.oooooooooo.se/api/v1/accounts
```

---

## License

MIT — Robert Fogeborg 2026

---

## Links

- **Repository**: https://github.com/fogennnnn/oldgreg
- **Issues**: https://github.com/fogennnnn/oldgreg/issues
- **HEMO Docs**: https://mcp-hemo.oooooooooo.se/llms.txt
- **Vault Docs**: https://hemo-vault.oooooooooo.se/llms.txt
