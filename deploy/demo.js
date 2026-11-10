'use strict';

// Opens and closes the demonstration over the internet (deploy/compose.tunnel.yml).
//
//   node deploy/demo.js start    stack + Cloudflare Quick Tunnel; prints the https address
//   node deploy/demo.js status   is the tunnel up, and at which address
//   node deploy/demo.js stop     removes the tunnel and puts the API back to TRUST_PROXY_HOPS=1
//
// The stack keeps running after `stop` (local homologation on http://localhost:3000, data kept).
// No account or login is used: a quick tunnel is anonymous and its address changes every start.
// Exit code: 0 done, 1 failed, 2 wrong usage.
const { spawnSync } = require('node:child_process');
const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const BASE = ['compose', '-f', path.join(__dirname, 'compose.yml')];
const WITH_TUNNEL = [...BASE, '-f', path.join(__dirname, 'compose.tunnel.yml')];
const ADDRESS = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function docker(args, { allowFail = false, quiet = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) throw new Error(`docker ${args.slice(-3).join(' ')} failed with code ${result.status}`);
  return result;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tunnelAddress() {
  const logs = docker([...WITH_TUNNEL, 'logs', 'tunnel'], { allowFail: true, quiet: true });
  const matches = `${logs.stdout}${logs.stderr}`.match(new RegExp(ADDRESS, 'g'));
  return matches ? matches[matches.length - 1] : null;
}
function tunnelRunning() {
  return docker([...WITH_TUNNEL, 'ps', '--status', 'running', '-q', 'tunnel'], { allowFail: true, quiet: true }).stdout.trim() !== '';
}
function apiTrustProxyHops() {
  return docker([...BASE, 'exec', '-T', 'api', 'printenv', 'TRUST_PROXY_HOPS'], { allowFail: true, quiet: true }).stdout.trim();
}

async function start() {
  if (!fs.existsSync(path.join(__dirname, '.env'))) throw new UsageError('deploy/.env is missing: cp deploy/.env.example deploy/.env and edit it first');
  docker([...WITH_TUNNEL, 'up', '-d', '--wait', '--wait-timeout', '300']);
  let address = null;
  for (let i = 0; i < 90 && !address; i += 1) {
    address = tunnelAddress();
    if (!address) await sleep(1000);
  }
  if (!address) throw new Error('the tunnel did not report an address in 90 s: docker compose -f deploy/compose.yml -f deploy/compose.tunnel.yml logs tunnel');
  console.log(`\n[demo] address: ${address}`);
  console.log(`[demo] API TRUST_PROXY_HOPS=${apiTrustProxyHops()} (expected 2 while the tunnel is up)`);

  // The name takes a few seconds to exist. Asking this machine's resolver (usually the
  // provider's, shared with the phones on the same Wi-Fi) BEFORE that makes it remember "does not
  // exist" for minutes: measured on 2026-10-16, more than 3 minutes. So the check only asks public
  // resolvers, and the address is announced once it answers.
  const host = new URL(address).hostname;
  let ip = null;
  for (let i = 0; i < 60 && !ip; i += 1) {
    ip = await publicLookup(host);
    if (!ip) await sleep(2000);
  }
  let status = 0;
  for (let i = 0; ip && i < 15 && status !== 200; i += 1) {
    status = await httpsStatus(`${address}/login`, ip);
    if (status !== 200) await sleep(2000);
  }
  if (status !== 200) {
    console.log(`[demo] ${address} is not answering yet (public DNS: ${ip ? 'ok' : 'not yet'}; last status ${status}). Wait a minute and run: node deploy/demo.js status`);
    return 1;
  }
  console.log(`[demo] ready: ${address}/login answers 200 over HTTPS (checked through public DNS)`);
  console.log('[demo] open it on the phone now (type the https:// address). If the phone says the site does not exist,');
  console.log('[demo] its Wi-Fi resolver remembered an earlier attempt: use mobile data, or wait a few minutes.');
  console.log('[demo] close it when the demonstration ends: node deploy/demo.js stop');
  return 0;
}

// Resolution through public resolvers only, never this machine's (see start()).
async function publicLookup(host) {
  const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  try {
    const [ip] = await resolver.resolve4(host);
    return ip || null;
  } catch {
    return null;
  }
}
function httpsStatus(url, ip) {
  return new Promise((resolve) => {
    const request = https.get(url, { lookup: (_host, options, callback) => (options && options.all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4)), timeout: 10000 }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(0));
  });
}

function status() {
  if (!tunnelRunning()) {
    console.log(`[demo] tunnel: not running. API TRUST_PROXY_HOPS=${apiTrustProxyHops() || '?'}`);
    return 0;
  }
  console.log(`[demo] tunnel: running at ${tunnelAddress() || '(address not found in the log)'}; API TRUST_PROXY_HOPS=${apiTrustProxyHops()}`);
  return 0;
}

function stop() {
  docker([...WITH_TUNNEL, 'rm', '--stop', '--force', 'tunnel']);
  // Same stack without the override: the API is recreated with TRUST_PROXY_HOPS from deploy/.env
  // and the web leaves the tunnel's network. Data volumes are untouched.
  docker([...BASE, 'up', '-d', '--wait', '--wait-timeout', '300', '--remove-orphans']);
  docker(['network', 'rm', 'restaurant-saas-stack_edge'], { allowFail: true, quiet: true });
  console.log(`[demo] tunnel closed. API TRUST_PROXY_HOPS=${apiTrustProxyHops()}; the stack keeps running locally`);
  return 0;
}

class UsageError extends Error {}

async function main(command) {
  try {
    if (command === 'start') return await start();
    if (command === 'status') return status();
    if (command === 'stop') return stop();
    throw new UsageError('usage: node deploy/demo.js start | status | stop');
  } catch (error) {
    console.error(`[demo] ${error.message}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

main(process.argv[2]).then((code) => {
  process.exitCode = code;
});
