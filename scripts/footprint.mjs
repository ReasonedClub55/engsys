#!/usr/bin/env node
// Compare what the `full` and `lite` profiles put in front of the model, by
// installing both into temp dirs (same stack) and measuring the result.
//
//   node scripts/footprint.mjs
//
// Sizes are bytes; tokens ≈ bytes / 4. This is a structural estimate of what is
// loaded — it does not measure billed usage, which depends on how you work.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runInstall } = require(path.join(root, 'lib/commands.js'));
const { loadConfig, frontmatterValue } = require(path.join(root, 'lib/util.js'));

const lite = loadConfig(path.join(root, 'profiles/lite/engsys.config.example.yaml'));
const full = loadConfig(path.join(root, 'engsys.config.example.yaml'));
full.stack = lite.stack;            // same stack on both sides: isolate the profile
full.project = lite.project;

const sizeOf = (f) => fs.statSync(f).size;
const ls = (d, ext) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !ext || f.endsWith(ext)) : []);
const descLen = (f) => ((fs.readFileSync(f, 'utf8').match(/^description:\s*(.*)$/m) || [])[1] || '').length;

function measure(config) {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'engsys-footprint-'));
  try {
    fs.writeFileSync(path.join(into, 'engsys.config.json'), JSON.stringify(config));
    runInstall({ engsysRoot: root, into, dryRun: false, mode: 'install' });
    const c = path.join(into, '.claude');
    const agents = ls(path.join(c, 'agents'), '.md').map((f) => path.join(c, 'agents', f));
    const commands = ls(path.join(c, 'commands'), '.md').map((f) => path.join(c, 'commands', f));
    const skills = ls(path.join(c, 'skills')).map((d) => path.join(c, 'skills', d, 'SKILL.md')).filter(fs.existsSync);
    const sum = (fs_, fn) => fs_.reduce((n, f) => n + fn(f), 0);
    const claudeMd = sizeOf(path.join(into, 'CLAUDE.md'));
    // What running a command pulls in: its own text + the workflow docs it points at.
    const cmdReads = {};
    for (const f of commands) {
      const text = fs.readFileSync(f, 'utf8');
      const wf = new Set([...text.matchAll(/(?:\.claude\/workflows\/|\]\()([A-Za-z0-9_.-]+-?[A-Za-z0-9_.-]*\.md)/g)].map((m) => m[1]));
      let bytes = sizeOf(f);
      for (const w of wf) {
        const p = path.join(c, 'workflows', w);
        if (fs.existsSync(p)) bytes += sizeOf(p);
      }
      cmdReads[path.basename(f, '.md')] = bytes;
    }
    return {
      agents: agents.length,
      opus: agents.filter((f) => frontmatterValue(f, 'model') === 'opus').length,
      agentBytes: sum(agents, sizeOf),
      commands: commands.length,
      skills: skills.length,
      claudeMd,
      // CLAUDE.md is loaded every session; agent/skill/command descriptions are
      // listed to the model every session too.
      alwaysOn: claudeMd + sum(agents, descLen) + sum(skills, descLen) + sum(commands, descLen),
      cmdReads,
    };
  } finally {
    fs.rmSync(into, { recursive: true, force: true });
  }
}

const F = measure(full);
const L = measure(lite);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const tok = (n) => `~${Math.round(n / 4 / 100) * 100} tok`;
const pct = (a, b) => (a ? `${Math.round((1 - b / a) * 100)}% less` : '—');
const row = (label, f, l, extra = '') => console.log(`${label.padEnd(30)}${String(f).padStart(22)}${String(l).padStart(22)}   ${extra}`);

console.log(`\nengsys footprint — same stack (${JSON.stringify(lite.stack)})\n`);
row('', 'full', 'lite');
row('agents', F.agents, L.agents);
row('  …running on Opus', F.opus, L.opus);
row('agent persona text', kb(F.agentBytes), kb(L.agentBytes), pct(F.agentBytes, L.agentBytes));
row('slash commands', F.commands, L.commands);
row('skills installed', F.skills, L.skills);
row('CLAUDE.md (every session)', kb(F.claudeMd), kb(L.claudeMd), pct(F.claudeMd, L.claudeMd));
row('always-loaded text (est.)*', `${kb(F.alwaysOn)} ${tok(F.alwaysOn)}`, `${kb(L.alwaysOn)} ${tok(L.alwaysOn)}`, pct(F.alwaysOn, L.alwaysOn));
console.log('\nread when you run the command (command text + the workflow docs it points at):');
for (const name of ['generate-project', 'implement-issue', 'implement-project', 'project-closeout']) {
  row(`  /${name}`, kb(F.cmdReads[name] || 0), kb(L.cmdReads[name] || 0), pct(F.cmdReads[name] || 0, L.cmdReads[name] || 0));
}
console.log('\n* CLAUDE.md + the agent/skill/command descriptions listed to the model every session.');
console.log('bytes ÷ 4 ≈ tokens. Structural estimate of what is loaded, not billed usage; the larger');
console.log('savings (agent fan-out, Opus, review loops) are in docs/lite-profile.md.\n');
