'use strict';

const { path, exists, fs, uniq, frontmatterValue } = require('./util');
const { resolveProfile, firstExisting } = require('./profile');

// Resolve which stack packs a config selects, as [category, value] paths
// under stacks/. Order matters only for display.
function selectedPacks(config) {
  const stack = config.stack || {};
  const packs = [];
  const seen = new Set();
  const add = (cat, val) => {
    if (!val || val === 'none') return;
    const rel = path.join(cat, String(val));
    if (seen.has(rel)) return;
    seen.add(rel);
    packs.push(rel);
  };
  // Every stack dimension accepts a scalar OR a list — mixed stacks compose.
  for (const c of [].concat(stack.cloud || [])) add('cloud', c);
  for (const i of [].concat(stack.iac || [])) add('iac', i);
  for (const d of [].concat(stack.db || [])) add('db', d);
  for (const l of [].concat(stack.lang || [])) add('lang', l);
  for (const p of [].concat(stack.platform || [])) add('platform', p);
  for (const d of [].concat(stack.domain || [])) add('domain', d);
  // Issue tracker resolves as a pack too. Defaults to github (zero-config keeps
  // today's behavior); set `issue_tracker: none` to opt out entirely.
  for (const t of [].concat(config.issue_tracker || 'github')) {
    if (t && t !== 'none') add('tooling', `issue-tracker-${t}`);
  }
  // Worker providers resolve as packs too (docs/multi-provider-spec.md § 6.1).
  // A provider listed under providers.workers is selected unless enabled: false —
  // no providers block means no worker layer, zero behavior change.
  for (const [name, w] of Object.entries(enabledWorkers(config))) {
    void w;
    add('tooling', `provider-${name}`);
  }
  return packs;
}

// providers.workers entries that are actually on. Shared with the renderer so
// the pack selection and the generated providers.json can never disagree.
function enabledWorkers(config) {
  const out = {};
  const workers = (config.providers && config.providers.workers) || {};
  for (const [name, w] of Object.entries(workers)) {
    if (w && typeof w === 'object' && w.enabled !== false) out[name] = w;
  }
  return out;
}

function listMd(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

// Build the full install plan: every copy operation + every fragment to merge.
function buildManifest(engsysRoot, config) {
  const core = path.join(engsysRoot, 'core');
  // `full` (default) leaves every lookup below exactly as it has always been;
  // a named profile overlays profiles/<name>/ on core/ (lib/profile.js).
  const profile = resolveProfile(engsysRoot, config);
  const inherit = (profile.def && profile.def.inherit) || {};
  const plan = {
    profile,         // { name, dir|null, def|null }
    agents: [],      // { src, name }
    commands: [],    // { src, name, description }
    skillDirs: [],   // { src(dir), name }  -> copied into .claude/skills/<name>
    workflows: [],   // { src, name }
    packHooks: [],   // { src, name } -> copied verbatim into .claude/hooks/
    claudeFragments: [], // { pack, text }
    settingsFragments: [], // parsed json objects
    mcpServers: {},  // merged
    scripts: [],     // { src, name } -> copied into .claude/scripts/<name> (name may nest)
    briefAdapters: [], // { src, name } -> .claude/workflows/briefs/adapters/<name>.md
    packs: selectedPacks(config),
    providers: enabledWorkers(config),
    warnings: [],
  };
  const hasProviders = Object.keys(plan.providers).length > 0;

  const seenAgent = new Set();
  const addAgent = (src, name) => {
    if (seenAgent.has(name)) { plan.warnings.push(`duplicate agent '${name}' skipped (${src})`); return; }
    seenAgent.add(name);
    plan.agents.push({ src, name });
  };

  // --- core agents ---
  // A profile supplies its own roster ('all' = that roster). Explicit names
  // resolve profile-first, then fall back to core, so a lite install can still
  // reach into the full catalog by name.
  const agentSel = (config.agents && config.agents.core) || 'all';
  const agentDirs = profile.dir
    ? [path.join(profile.dir, 'agents'), path.join(core, 'agents')]
    : [path.join(core, 'agents')];
  const coreAgentFiles = agentSel === 'all'
    ? listMd(agentDirs[0])
    : [].concat(agentSel).map((n) => `${n}.md`);
  for (const f of coreAgentFiles) {
    const src = firstExisting(agentDirs.map((d) => path.join(d, f)));
    if (!src) { plan.warnings.push(`core agent not found: ${f}`); continue; }
    addAgent(src, f);
  }

  // --- extra (optional) agents ---
  const extra = (config.agents && config.agents.extra) || [];
  const extraDirs = [...(profile.dir ? agentDirs : []), path.join(engsysRoot, 'optional-agents')];
  for (const n of [].concat(extra)) {
    const src = firstExisting(extraDirs.map((d) => path.join(d, `${n}.md`)));
    if (!src) { plan.warnings.push(`optional agent not found: ${n}`); continue; }
    addAgent(src, `${n}.md`);
  }

  // --- commands ---
  const cmdSel = config.commands || 'all';
  const cmdDirs = profile.dir
    ? [path.join(profile.dir, 'commands'), path.join(core, 'commands')]
    : [path.join(core, 'commands')];
  let cmdFiles;
  if (cmdSel !== 'all') cmdFiles = [].concat(cmdSel).map((n) => `${n}.md`);
  else if (profile.dir) cmdFiles = uniq([...listMd(cmdDirs[0]), ...(inherit.commands || []).map((n) => `${n}.md`)]).sort();
  else cmdFiles = listMd(cmdDirs[0]);
  const { frontmatterDescription } = require('./util');
  for (const f of cmdFiles) {
    const src = firstExisting(cmdDirs.map((d) => path.join(d, f)));
    if (!src) { plan.warnings.push(`command not found: ${f}`); continue; }
    plan.commands.push({ src, name: f, description: frontmatterDescription(src) });
  }

  // --- core skills (always all; a profile installs its own + a named subset,
  // plus anything the project adds via `skills.extra`) ---
  const coreSkillsDir = path.join(core, 'skills');
  if (!profile.dir) {
    if (exists(coreSkillsDir)) {
      for (const d of fs.readdirSync(coreSkillsDir, { withFileTypes: true })) {
        if (d.isDirectory()) plan.skillDirs.push({ src: path.join(coreSkillsDir, d.name), name: d.name });
      }
    }
  } else {
    const seen = new Set();
    const ownDir = path.join(profile.dir, 'skills');
    if (exists(ownDir)) {
      for (const d of fs.readdirSync(ownDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        seen.add(d.name);
        plan.skillDirs.push({ src: path.join(ownDir, d.name), name: d.name });
      }
    }
    const projectSkills = (config.skills && config.skills.extra) || [];
    for (const n of uniq([...(inherit.skills || []), ...[].concat(projectSkills)])) {
      if (seen.has(n)) continue;
      const src = path.join(coreSkillsDir, n);
      if (!exists(src)) { plan.warnings.push(`skill not found: ${n}`); continue; }
      seen.add(n);
      plan.skillDirs.push({ src, name: n });
    }
  }

  // --- core workflows (briefs/ subdir installs alongside) ---
  // A profile installs none of its own long-form workflows (its commands are
  // self-contained) — only the worker-dispatch docs, and only when providers
  // are enabled, because the provider packs link to them.
  const wfDir = path.join(core, 'workflows');
  if (!profile.dir) {
    for (const f of listMd(wfDir)) plan.workflows.push({ src: path.join(wfDir, f), name: f });
    const briefsDir = path.join(wfDir, 'briefs');
    for (const f of listMd(briefsDir)) {
      plan.workflows.push({ src: path.join(briefsDir, f), name: path.join('briefs', f) });
    }
  } else {
    const ownWf = path.join(profile.dir, 'workflows');
    for (const f of listMd(ownWf)) plan.workflows.push({ src: path.join(ownWf, f), name: f });
    if (hasProviders) {
      for (const entry of inherit.workflows_if_providers || []) {
        if (entry.endsWith('/')) {
          for (const f of listMd(path.join(wfDir, entry))) {
            plan.workflows.push({ src: path.join(wfDir, entry, f), name: path.join(entry, f) });
          }
        } else if (exists(path.join(wfDir, entry))) {
          plan.workflows.push({ src: path.join(wfDir, entry), name: entry });
        } else {
          plan.warnings.push(`workflow not found: ${entry}`);
        }
      }
    }
  }

  // --- core worker scripts (only when a provider pack is selected — projects
  // without a providers: block see zero change) ---
  if (hasProviders) {
    const scriptsDir = path.join(core, 'scripts');
    plan.scripts.push({ src: path.join(scriptsDir, 'worker-run.mjs'), name: 'worker-run.mjs' });
    plan.scripts.push({ src: path.join(scriptsDir, 'worker-package.mjs'), name: 'worker-package.mjs' });
    plan.scripts.push({ src: path.join(scriptsDir, '_env.mjs'), name: '_env.mjs' });
    plan.scripts.push({
      src: path.join(scriptsDir, 'workers', '_claude-cli.mjs'),
      name: path.join('workers', '_claude-cli.mjs'),
    });
  }

  // --- stack packs ---
  const seenSkill = new Set(plan.skillDirs.map((s) => s.name));
  for (const rel of plan.packs) {
    const packDir = path.join(engsysRoot, 'stacks', rel);
    if (!exists(packDir)) { plan.warnings.push(`pack not found: ${rel}`); continue; }

    const skillsDir = path.join(packDir, 'skills');
    if (exists(skillsDir)) {
      for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        if (seenSkill.has(d.name)) { plan.warnings.push(`duplicate skill '${d.name}' from ${rel} skipped`); continue; }
        seenSkill.add(d.name);
        plan.skillDirs.push({ src: path.join(skillsDir, d.name), name: d.name });
      }
    }

    const agentsDir = path.join(packDir, 'agents');
    for (const f of listMd(agentsDir)) addAgent(path.join(agentsDir, f), f);

    const hooksDir = path.join(packDir, 'hooks');
    if (exists(hooksDir)) {
      for (const f of fs.readdirSync(hooksDir)) {
        plan.packHooks.push({ src: path.join(hooksDir, f), name: f });
      }
    }

    // Provider packs additionally ship an adapter script, a capabilities
    // declaration, and a brief adapter note (spec § 6.1).
    const provMatch = rel.match(/^tooling[/\\]provider-([a-z0-9-]+)$/);
    if (provMatch) {
      const provider = provMatch[1];
      const packScriptsDir = path.join(packDir, 'scripts');
      if (exists(packScriptsDir)) {
        for (const f of fs.readdirSync(packScriptsDir)) {
          if (f.endsWith('.mjs')) plan.scripts.push({ src: path.join(packScriptsDir, f), name: path.join('workers', f) });
        }
      }
      const caps = path.join(packDir, 'capabilities.json');
      if (exists(caps)) {
        plan.scripts.push({ src: caps, name: path.join('workers', `${provider}.capabilities.json`) });
      }
      const note = path.join(packDir, 'briefs', 'adapter-note.md');
      if (exists(note)) plan.briefAdapters.push({ src: note, name: `${provider}.md` });
    }

    const frag = path.join(packDir, 'claude.fragment.md');
    if (exists(frag)) plan.claudeFragments.push({ pack: rel, text: require('./util').readText(frag).trim() });

    const sfrag = path.join(packDir, 'settings.fragment.json');
    if (exists(sfrag)) {
      try {
        const obj = JSON.parse(require('./util').readText(sfrag));
        plan.settingsFragments.push(obj);
        Object.assign(plan.mcpServers, obj.mcpServers || {});
      } catch (e) {
        plan.warnings.push(`invalid settings.fragment.json in ${rel}: ${e.message}`);
      }
    }
  }

  // Merge any MCP servers declared directly in naturalize config.
  if (config.naturalize && config.naturalize.mcp_servers) {
    Object.assign(plan.mcpServers, config.naturalize.mcp_servers);
  }

  // A profile exists to keep usage down: say so when something selected anyway
  // (agents.extra, a pack agent, a hand-picked core agent) runs on Opus.
  if (profile.dir) {
    for (const a of plan.agents) {
      if (frontmatterValue(a.src, 'model') === 'opus') {
        plan.warnings.push(`agent '${a.name.replace(/\.md$/, '')}' runs on Opus — heavy on a limited plan (profile: ${profile.name})`);
      }
    }
  }

  return plan;
}

module.exports = { buildManifest, selectedPacks };
