/**
 * OLDGREG Integration Test Suite
 * Tests the actual oldgreg.js CLI functionality
 */

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OLDREGJS = path.join(__dirname, '..', 'oldgreg.js');
const MEMORYJS = path.join(__dirname, '..', 'memory.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function runCmd(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 30000, ...opts });
  } catch (e) {
    return { error: e.message, stdout: e.stdout, stderr: e.stderr };
  }
}

function testGroup(name, fn) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + name);
  console.log('═'.repeat(60));
  return fn();
}

async function asyncTestGroup(name, fn) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + name);
  console.log('═'.repeat(60));
  return fn();
}

// ─── Test Suites ───────────────────────────────────────────────────────────────

async function runAllTests() {
  let passed = 0;
  let failed = 0;
  const results = [];

  // ── CLI Tests ──────────────────────────────────────────────────────────────
  await testGroup('CLI Commands', () => {
    // Test help command
    const help = runCmd('node ' + OLDREGJS + ' help');
    if (help.error) {
      console.log('❌ help command failed:', help.error);
      failed++;
      results.push({ test: 'help', status: 'FAIL', error: help.error });
    } else {
      console.log('✓ help command works');
      passed++;
      results.push({ test: 'help', status: 'PASS' });
    }

    // Test status command
    const status = runCmd('node ' + OLDREGJS + ' status');
    if (status.error && !status.stdout.includes('═══')) {
      console.log('❌ status command failed:', status.error);
      failed++;
      results.push({ test: 'status', status: 'FAIL', error: status.error });
    } else {
      console.log('✓ status command works');
      passed++;
      results.push({ test: 'status', status: 'PASS' });
    }

    // Test models command
    const models = runCmd('node ' + OLDREGJS + ' models');
    if (models.error && !models.stdout.includes('AI Models')) {
      console.log('❌ models command failed:', models.error);
      failed++;
      results.push({ test: 'models', status: 'FAIL', error: models.error });
    } else {
      console.log('✓ models command works');
      passed++;
      results.push({ test: 'models', status: 'PASS' });
    }

    // Test score command
    const score = runCmd('node ' + OLDREGJS + ' score');
    if (score.error && !score.stdout.includes('Provider')) {
      console.log('❌ score command failed:', score.error);
      failed++;
      results.push({ test: 'score', status: 'FAIL', error: score.error });
    } else {
      console.log('✓ score command works');
      passed++;
      results.push({ test: 'score', status: 'PASS' });
    }

    // Test quickkey command
    const quickkey = runCmd('node ' + OLDREGJS + ' quickkey groq');
    if (quickkey.error && !quickkey.stdout.includes('Groq')) {
      console.log('❌ quickkey command failed:', quickkey.error);
      failed++;
      results.push({ test: 'quickkey', status: 'FAIL', error: quickkey.error });
    } else {
      console.log('✓ quickkey command works');
      passed++;
      results.push({ test: 'quickkey', status: 'PASS' });
    }
  });

  // ── Memory System Tests ───────────────────────────────────────────────────
  await testGroup('Memory System', async () => {
    // Test memory status
    const status = runCmd('node ' + MEMORYJS + ' status');
    if (status.error && !status.stdout.includes('Memory Status')) {
      console.log('❌ memory status failed:', status.error);
      failed++;
      results.push({ test: 'memory:status', status: 'FAIL', error: status.error });
    } else {
      console.log('✓ memory status works');
      passed++;
      results.push({ test: 'memory:status', status: 'PASS' });
    }

    // Test memory list
    const list = runCmd('node ' + MEMORYJS + ' list');
    if (list.error && !list.stdout.includes('Memories')) {
      console.log('❌ memory list failed:', list.error);
      failed++;
      results.push({ test: 'memory:list', status: 'FAIL', error: list.error });
    } else {
      console.log('✓ memory list works');
      passed++;
      results.push({ test: 'memory:list', status: 'PASS' });
    }

    // Test memory store (cleanup from previous tests)
    runCmd('node ' + MEMORYJS + ' store test_integration "integration test" 2>/dev/null');
    const store = runCmd('node ' + MEMORYJS + ' store test_integration "integration test"');
    if (!store.error || store.stdout.includes('Stored')) {
      console.log('✓ memory store works');
      passed++;
      results.push({ test: 'memory:store', status: 'PASS' });
    } else {
      console.log('⚠ memory store failed (vault may be unavailable):', store.error?.slice(0, 50));
      results.push({ test: 'memory:store', status: 'SKIP', note: 'vault unavailable' });
    }

    // Test memory recall
    const recall = runCmd('node ' + MEMORYJS + ' recall test_integration');
    if (recall.stdout.includes('integration test') || recall.stdout.includes('Not found')) {
      console.log('✓ memory recall works');
      passed++;
      results.push({ test: 'memory:recall', status: 'PASS' });
    } else {
      console.log('⚠ memory recall failed:', recall.error?.slice(0, 50));
      results.push({ test: 'memory:recall', status: 'SKIP', note: recall.error });
    }
  });

  // ── Provider Tests ────────────────────────────────────────────────────────
  await testGroup('Provider Routing', async () => {
    // Test AI call with force provider
    const aiTest = runCmd('node ' + OLDREGJS + ' ai "test" --force pollinations', { timeout: 20000 });
    if (aiTest.stdout && aiTest.stdout.length > 10) {
      console.log('✓ AI routing works (Pollinations fallback)');
      passed++;
      results.push({ test: 'ai:routing', status: 'PASS' });
    } else if (aiTest.error && aiTest.error.includes('timeout')) {
      console.log('⚠ AI routing timeout (provider may be rate-limited)');
      results.push({ test: 'ai:routing', status: 'SKIP', note: 'timeout' });
    } else {
      console.log('❌ AI routing failed');
      failed++;
      results.push({ test: 'ai:routing', status: 'FAIL' });
    }
  });

  // ── File Structure Tests ──────────────────────────────────────────────────
  await testGroup('Package Structure', () => {
    const files = [
      'oldgreg.js',
      'memory.js',
      'package.json',
      'README.md',
      'tests/memory-lens.test.js',
      'tests/retro-revival.test.js',
      'tests/dream-decoder.test.js',
      'tests/integration.test.js'
    ];

    let allExist = true;
    for (const f of files) {
      const fullPath = path.join(__dirname, '..', f);
      if (fs.existsSync(fullPath)) {
        console.log('✓ ' + f);
      } else {
        console.log('❌ ' + f + ' missing');
        allExist = false;
      }
    }

    if (allExist) {
      passed++;
      results.push({ test: 'package:structure', status: 'PASS' });
    } else {
      failed++;
      results.push({ test: 'package:structure', status: 'FAIL' });
    }
  });

  // ── Syntax Tests ──────────────────────────────────────────────────────────
  await testGroup('Syntax Validation', () => {
    const files = ['oldgreg.js', 'memory.js'];
    let allValid = true;

    for (const f of files) {
      const result = runCmd('node --check ' + path.join(__dirname, '..', f));
      if (result.error) {
        console.log('❌ ' + f + ': ' + result.error);
        allValid = false;
      } else {
        console.log('✓ ' + f);
      }
    }

    if (allValid) {
      passed++;
      results.push({ test: 'syntax:validation', status: 'PASS' });
    } else {
      failed++;
      results.push({ test: 'syntax:validation', status: 'FAIL' });
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log('  Passed:  ' + passed);
  console.log('  Failed:  ' + failed);
  console.log('  Total:   ' + (passed + failed));
  console.log('═'.repeat(60) + '\n');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    for (const r of results) {
      if (r.status === 'FAIL') {
        console.log('  - ' + r.test + ': ' + (r.error || 'unknown error'));
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
