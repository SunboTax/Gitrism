#!/usr/bin/env node
try {
  require('../out/localCli').main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
} catch (error) {
  console.error('Build Gitrism first: npm ci && npm run compile'); process.exitCode = 1;
}
