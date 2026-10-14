'use strict';

// Tiny zero-dep test harness for lib/. Run: npm test
const assert = require('assert');
const path = require('path');
const { parseYaml } = require('./yaml');
const render = require('./render');

const ENGSYS_ROOT = path.join(__dirname, '..');

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`  ok ${name}`); }

check('scalars and inline lists', () => {
  const c = parseYaml(`
project:
  name: Acme Widgets
  description: A one-liner.
stack:
  cloud: aws
  iac: none
  lang: [typescript, python]
  db: none
commands: all
`);
  assert.strictEqual(c.project.name, 'Acme Widgets');
  assert.strictEqual(c.project.description, 'A one-liner.');
  assert.strictEqual(c.stack.cloud, 'aws');
  assert.deepStrictEqual(c.stack.lang, ['typescript', 'python']);
  assert.strictEqual(c.commands, 'all');
});

check('quoted strings keep punctuation', () => {
  const c = parseYaml(`
naturalize:
  model_strategy: "Opus for judgement; Sonnet for execution."
`);
  assert.strictEqual(c.naturalize.model_strategy, 'Opus for judgement; Sonnet for execution.');
});

check('block list of maps (hook_patterns)', () => {
  const c = parseYaml(`
naturalize:
  hook_patterns:
    - glob: "*/schema.prisma"
      reminder: "Regenerate the client."
    - glob: "docs/spec.md"
      reminder: "Bump the version header."
  invariants: []
`);
  assert.strictEqual(c.naturalize.hook_patterns.length, 2);
  assert.strictEqual(c.naturalize.hook_patterns[0].glob, '*/schema.prisma');
  assert.strictEqual(c.naturalize.hook_patterns[0].reminder, 'Regenerate the client.');
  assert.strictEqual(c.naturalize.hook_patterns[1].glob, 'docs/spec.md');
  assert.deepStrictEqual(c.naturalize.invariants, []);
});

check('agents block with extra list', () => {
  const c = parseYaml(`
agents:
  core: all
  extra: [sandy, gary]
`);
  assert.strictEqual(c.agents.core, 'all');
  assert.deepStrictEqual(c.agents.extra, ['sandy', 'gary']);
});

check('comments and bools', () => {
  const c = parseYaml(`
# a comment
stack:
  cloud: azure   # trailing comment
flag: true
empty: ~
`);
  assert.strictEqual(c.stack.cloud, 'azure');
  assert.strictEqual(c.flag, true);
  assert.strictEqual(c.empty, null);
});

check('malformed YAML cannot silently truncate the remaining config', () => {
  for (const [text, line] of [
    ['# comment\n\nproject:\n  name: Test\nbroken line\nstack:\n  cloud: aws\n', 5],
    ['stack:\n  cloud: aws\n lang: python\n', 3],
    ['not a mapping\nproject:\n  name: Test\n', 1],
    ['agents:\n  core: all\n  - unexpected\n', 3],
  ]) {
    assert.throws(() => parseYaml(text), new RegExp(`malformed YAML at line ${line}`));
  }
});

check('block scalar (project_facts: |)', () => {
  const c = parseYaml(`
naturalize:
  project_facts: |
    - Serve with \`python3 -m http.server 8517\`.
    - Architecture: \`data.js\` is the read-only baseline.
  model_strategy: "after the block"
`);
  assert.strictEqual(
    c.naturalize.project_facts,
    '- Serve with `python3 -m http.server 8517`.\n- Architecture: `data.js` is the read-only baseline.\n'
  );
  assert.strictEqual(c.naturalize.model_strategy, 'after the block');
});

check('block scalar nested under a block-list map (hook_patterns reminder)', () => {
  const c = parseYaml(`
naturalize:
  hook_patterns:
    - glob: "docs/spec.md"
      reminder: |
        Bump the version header.
        Keep cross-refs in sync.
`);
  assert.strictEqual(
    c.naturalize.hook_patterns[0].reminder,
    'Bump the version header.\nKeep cross-refs in sync.\n'
  );
});

check('block scalar chomp indicators (strip/keep)', () => {
  const c = parseYaml(`
a: |-
  no trailing newline
b: |+
  keep trailing newline
c: >
  folded into
  one line
`);
  assert.strictEqual(c.a, 'no trailing newline');
  assert.strictEqual(c.b, 'keep trailing newline\n');
  assert.strictEqual(c.c, 'folded into one line\n');
});

check('inline flow maps (single-line stack/lessons)', () => {
  const c = parseYaml(`
project: {name: SeedTest, description: x}
stack: {cloud: aws, lang: [typescript, python], platform: [web]}
lessons: {seed: false}
`);
  assert.strictEqual(c.project.name, 'SeedTest');
  assert.strictEqual(c.stack.cloud, 'aws');
  assert.deepStrictEqual(c.stack.lang, ['typescript', 'python']);
  assert.deepStrictEqual(c.stack.platform, ['web']);
  assert.strictEqual(c.lessons.seed, false);
});

check('renderClaudeMd appends naturalize.invariants to project facts', () => {
  const config = {
    project: { name: 'Acme', description: 'desc' },
    naturalize: {
      project_facts: 'Base facts.',
      invariants: ['Never commit *.secret files.', 'Always run tests before push.'],
    },
  };
  const plan = { claudeFragments: [], mcpServers: {}, commands: [] };
  const out = render.renderClaudeMd(ENGSYS_ROOT, config, plan, null, null);
  assert.ok(out.includes('Base facts.'));
  assert.ok(out.includes('**Invariants (hard rules).**'));
  assert.ok(out.includes('- Never commit *.secret files.'));
  assert.ok(out.includes('- Always run tests before push.'));
});

check('renderClaudeMd omits the invariants heading when none are configured', () => {
  const config = { project: {}, naturalize: { project_facts: 'Base facts.' } };
  const plan = { claudeFragments: [], mcpServers: {}, commands: [] };
  const out = render.renderClaudeMd(ENGSYS_ROOT, config, plan, null, null);
  assert.ok(!out.includes('Invariants (hard rules)'));
});

check('renderMcpJson preserves naturalized values, refreshes unfilled placeholders', () => {
  const plan = {
    mcpServers: {
      xcodebuildmcp: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'xcodebuildmcp@latest', 'mcp'],
        env: {
          XCODEBUILDMCP_PROJECT_PATH: '<naturalize: path/to/App.xcodeproj>',
          XCODEBUILDMCP_SCHEME: '<naturalize: scheme>',
          XCODEBUILDMCP_PLATFORM: 'iOS Simulator',
        },
      },
    },
  };
  const existing = {
    mcpServers: {
      xcodebuildmcp: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'xcodebuildmcp@latest', 'mcp'],
        env: {
          XCODEBUILDMCP_PROJECT_PATH: 'App/App.xcodeproj',
          XCODEBUILDMCP_SCHEME: 'App',
          XCODEBUILDMCP_PLATFORM: 'iOS Simulator',
        },
      },
      custom: { type: 'stdio', command: 'my-own-server' },
    },
  };
  const out = JSON.parse(render.renderMcpJson(plan, existing));
  assert.strictEqual(out.mcpServers.xcodebuildmcp.env.XCODEBUILDMCP_PROJECT_PATH, 'App/App.xcodeproj');
  assert.strictEqual(out.mcpServers.xcodebuildmcp.env.XCODEBUILDMCP_SCHEME, 'App');
  assert.strictEqual(out.mcpServers.xcodebuildmcp.env.XCODEBUILDMCP_PLATFORM, 'iOS Simulator');
  assert.strictEqual(out.mcpServers.custom.command, 'my-own-server');
});

check('providers block (nested maps, per-role models)', () => {
  const c = parseYaml(`
providers:
  conductor: anthropic
  workers:
    codex:
      enabled: true
      models:
        implement: gpt-5.6-terra
        review: gpt-5.6-sol
    grok:
      enabled: false
  routing:
    implement_default: codex
    review_fallback_chain: [codex, grok, anthropic]
  parallel:
    enabled: false
    max_workers: 3
  timeouts:
    implement: 3600
`);
  assert.strictEqual(c.providers.conductor, 'anthropic');
  assert.strictEqual(c.providers.workers.codex.enabled, true);
  assert.strictEqual(c.providers.workers.codex.models.review, 'gpt-5.6-sol');
  assert.strictEqual(c.providers.workers.grok.enabled, false);
  assert.deepStrictEqual(c.providers.routing.review_fallback_chain, ['codex', 'grok', 'anthropic']);
  assert.strictEqual(c.providers.parallel.enabled, false);
  assert.strictEqual(c.providers.timeouts.implement, 3600);
});

check('normalizeProviders: defaults, families, disabled workers dropped', () => {
  const { normalizeProviders } = require('./render');
  const n = normalizeProviders({
    providers: {
      workers: {
        codex: { enabled: true, models: { implement: 'gpt-5.6-terra' } },
        grok: { enabled: false },
        deepseek: { enabled: true, models: { review: 'deepseek-v4-pro' } },
      },
    },
  });
  assert.deepStrictEqual(Object.keys(n.workers), ['codex', 'deepseek']);
  assert.strictEqual(n.workers.codex.family, 'openai');
  assert.strictEqual(n.workers.deepseek.family, 'deepseek');
  assert.strictEqual(n.routing.implement_default, 'codex');
  assert.strictEqual(n.routing.review, 'cross_family');
  // The chain contains only enabled workers — a disabled provider in the
  // fallback chain would be a dispatch that can never run.
  assert.deepStrictEqual(n.routing.review_fallback_chain, ['codex', 'deepseek']);
  assert.strictEqual(n.parallel.enabled, false);
  assert.strictEqual(n.timeouts.review, 2700);
});

check('normalizeProviders: no providers block → empty workers', () => {
  const { normalizeProviders, renderProviderRouting } = require('./render');
  const n = normalizeProviders({});
  assert.deepStrictEqual(n.workers, {});
  assert.ok(/No external worker providers/.test(renderProviderRouting({})));
});

check('providersBlock: parses, normalizes, and refuses unknown names', () => {
  const { providersBlock, normalizeProviders } = require('./render');
  const block = providersBlock(['codex', 'grok']);
  const parsed = parseYaml(block);
  const n = normalizeProviders(parsed);
  assert.deepStrictEqual(Object.keys(n.workers), ['codex', 'grok']);
  assert.strictEqual(n.workers.codex.models.review, 'gpt-5.6-sol');
  assert.strictEqual(parsed.providers.workers.grok.via, 'auto');
  assert.throws(() => providersBlock(['codex', 'gemini']), /unknown provider/);
});

check('selectedPacks includes enabled provider packs only', () => {
  const { selectedPacks } = require('./manifest');
  const packs = selectedPacks({
    stack: { lang: ['typescript'] },
    providers: { workers: { codex: { enabled: true }, grok: { enabled: false } } },
  });
  assert.ok(packs.includes('tooling/provider-codex'), `missing provider-codex in ${packs}`);
  assert.ok(!packs.some((p) => p.includes('provider-grok')), 'disabled grok pack selected');
});


// --- profiles (docs/lite-profile.md) -----------------------------------------
// `full` must stay exactly the engsys that has always existed; `lite` is an
// overlay that only ever removes cost. These checks pin both halves.

const fs = require('fs');
const os = require('os');
const { buildManifest } = require('./manifest');
const { frontmatterValue } = require('./util');

const names = (list) => list.map((x) => x.name.replace(/\.md$/, '')).sort();
const mdNames = (dir) => fs.readdirSync(path.join(ENGSYS_ROOT, dir)).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const LITE = { profile: 'lite', stack: { lang: ['typescript'] } };

check('profile default (full) installs the whole core roster, unchanged', () => {
  const plan = buildManifest(ENGSYS_ROOT, { stack: { lang: ['typescript'] } });
  assert.strictEqual(plan.profile.dir, null);
  assert.deepStrictEqual(names(plan.agents), mdNames('core/agents'));
  assert.deepStrictEqual(names(plan.commands), mdNames('core/commands'));
  const coreSkills = fs.readdirSync(path.join(ENGSYS_ROOT, 'core/skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const s of coreSkills) assert.ok(plan.skillDirs.some((d) => d.name === s), `full is missing core skill ${s}`);
  assert.ok(plan.workflows.length > 0);
  assert.ok(!plan.warnings.some((w) => /Opus/.test(w)), 'full must not emit the lite Opus warning');
});

check('explicit profile: full is the same as no profile', () => {
  const a = buildManifest(ENGSYS_ROOT, { stack: { lang: ['typescript'] } });
  const b = buildManifest(ENGSYS_ROOT, { profile: 'full', stack: { lang: ['typescript'] } });
  assert.deepStrictEqual(names(a.agents), names(b.agents));
  assert.deepStrictEqual(names(a.commands), names(b.commands));
  assert.deepStrictEqual(a.skillDirs.map((d) => d.name), b.skillDirs.map((d) => d.name));
});

check('unknown profile fails loudly and lists the available ones', () => {
  assert.throws(() => buildManifest(ENGSYS_ROOT, { profile: 'nope' }), /unknown profile 'nope'.*full, lite/);
});

check('lite: small Sonnet-only roster, no orchestration commands or heavy skills', () => {
  const plan = buildManifest(ENGSYS_ROOT, LITE);
  assert.deepStrictEqual(names(plan.agents), ['aaron', 'bert', 'isabelle', 'jody', 'nyx', 'patricia']);
  for (const a of plan.agents) {
    assert.strictEqual(frontmatterValue(a.src, 'model'), 'sonnet', `${a.name} must run on sonnet`);
  }
  assert.deepStrictEqual(names(plan.commands), [
    'design-critique', 'file-issue', 'generate-project', 'implement-issue',
    'implement-project', 'naturalize', 'pre-push', 'project-closeout',
  ]);
  const skills = plan.skillDirs.map((d) => d.name);
  assert.ok(skills.includes('lenses') && skills.includes('code-review') && skills.includes('issue-tracker-github'));
  for (const heavy of ['merge-monster', 'gh-cli', 'interactive-explainer', 'llm-structured-outputs', 'refactor', 'git-workflow-agents']) {
    assert.ok(!skills.includes(heavy), `lite must not install ${heavy}`);
  }
  assert.deepStrictEqual(plan.workflows, [], 'no workflow docs without providers');
  assert.deepStrictEqual(plan.warnings, []);
});

check('lite + providers installs the worker-dispatch docs the provider packs link to', () => {
  const plan = buildManifest(ENGSYS_ROOT, Object.assign({}, LITE, { providers: { workers: { codex: { enabled: true } } } }));
  const wf = plan.workflows.map((w) => w.name);
  assert.ok(wf.includes('worker-dispatch.md'), wf.join());
  assert.ok(wf.some((n) => n.startsWith('briefs')), wf.join());
});

check('lite: explicit names fall back to core, and an Opus pick is flagged', () => {
  const plan = buildManifest(ENGSYS_ROOT, Object.assign({}, LITE, { agents: { core: ['isabelle'], extra: ['melvin'] } }));
  assert.deepStrictEqual(names(plan.agents), ['isabelle', 'melvin']);
  assert.ok(plan.warnings.some((w) => /melvin.*Opus/.test(w)), plan.warnings.join());
});

check('lite: skills.extra pulls extra core skills in; unknown names warn', () => {
  const plan = buildManifest(ENGSYS_ROOT, Object.assign({}, LITE, { skills: { extra: ['refactor', 'not-a-skill'] } }));
  assert.ok(plan.skillDirs.some((d) => d.name === 'refactor'));
  assert.ok(plan.warnings.some((w) => /skill not found: not-a-skill/.test(w)));
});

check('lite CLAUDE.md: valid, tidy, optional sections omitted, much smaller than full', () => {
  const plan = { claudeFragments: [], mcpServers: {}, commands: [], profile: buildManifest(ENGSYS_ROOT, LITE).profile };
  const config = { project: { name: 'Acme', description: 'd' }, naturalize: { project_facts: 'Facts.' } };
  const lite = render.renderClaudeMd(ENGSYS_ROOT, config, plan, null, null);
  const full = render.renderClaudeMd(ENGSYS_ROOT, config, { claudeFragments: [], mcpServers: {}, commands: [] }, null, null);
  assert.ok(lite.includes(render.PF_START) && lite.includes(render.PF_END), 'project-facts markers must survive');
  assert.ok(!/\{\{\w+\}\}/.test(lite), 'unfilled placeholder in lite CLAUDE.md');
  assert.ok(!/\n{3,}/.test(lite), 'blank-line runs left behind by omitted sections');
  assert.ok(!lite.includes('## Worker providers'), 'provider section must be omitted when no workers');
  assert.ok(lite.includes('Usage discipline'));
  assert.ok(lite.length < full.length * 0.8, `lite ${lite.length}B should be well under full ${full.length}B`);
  const withWorkers = render.renderClaudeMd(ENGSYS_ROOT, Object.assign({}, config, { providers: { workers: { codex: { enabled: true } } } }), plan, null, null);
  assert.ok(withWorkers.includes('## Worker providers') && withWorkers.includes('codex'));
  // Preserves hand-edited facts on update, like full.
  const kept = render.renderClaudeMd(ENGSYS_ROOT, config, plan, lite.replace('Facts.', 'Hand-edited.'), null);
  assert.ok(kept.includes('Hand-edited.') && !kept.includes('Facts.'));
});

check('lite settings pin the model; a deliberate project choice survives; full pins nothing', () => {
  const litePlan = { settingsFragments: [], profile: buildManifest(ENGSYS_ROOT, LITE).profile };
  const fullPlan = { settingsFragments: [] };
  const lite = JSON.parse(render.renderSettings(ENGSYS_ROOT, litePlan, null));
  assert.strictEqual(lite.model, 'sonnet');
  assert.strictEqual(Object.keys(lite)[0], 'model');
  assert.ok(lite.permissions.allow.length && lite.hooks, 'lite keeps the shared permissions and hook');
  const kept = JSON.parse(render.renderSettings(ENGSYS_ROOT, litePlan, { model: 'opus' }));
  assert.strictEqual(kept.model, 'opus');
  const full = JSON.parse(render.renderSettings(ENGSYS_ROOT, fullPlan, { model: 'sonnet' }));
  assert.ok(!('model' in full), 'full must not carry a model pin');
});

// End to end: install lite, verify, switch to full (orphans pruned), and back.
function withTempProject(configText, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engsys-profile-'));
  try {
    fs.writeFileSync(path.join(dir, 'engsys.config.yaml'), configText);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const read = (f) => fs.readFileSync(f, 'utf8');

check('malformed config aborts an update before changing the installed project', () => {
  const { runInstall, runVerify } = require('./commands');
  withTempProject('profile: lite\nproject: {name: ParseGuard}\n', into => {
    runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
    const lockPath = path.join(into, '.claude/engsys.lock');
    const beforeLock = read(lockPath);
    const before = Object.fromEntries(Object.keys(JSON.parse(beforeLock).managed)
      .map(rel => [rel, read(path.join(into, rel))]));
    fs.writeFileSync(path.join(into, 'engsys.config.yaml'), 'profile: lite\nproject: {name: ParseGuard}\nbroken line\nagents:\n  core: none\n');
    assert.throws(() => runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'update' }), /malformed YAML at line 3/);
    assert.strictEqual(read(lockPath), beforeLock);
    for (const [rel, text] of Object.entries(before)) assert.strictEqual(read(path.join(into, rel)), text, rel);
    assert.strictEqual(runVerify({ into }).ok, true);
  });
});
const litePlus = (extra) => read(path.join(ENGSYS_ROOT, 'profiles/lite/engsys.config.example.yaml')) + (extra || '');

check('lite example config parses and installs; verify is clean; lock records the profile', () => {
  const { runInstall, runVerify } = require('./commands');
  withTempProject(litePlus(), (into) => {
    const r = runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
    assert.strictEqual(r.plan.profile.name, 'lite');
    assert.ok(r.actions.includes('profile:   lite'));
    assert.strictEqual(JSON.parse(read(path.join(into, '.claude/engsys.lock'))).profile, 'lite');
    assert.ok(runVerify({ into, skipDoctor: true }).ok);
    assert.ok(!fs.existsSync(path.join(into, 'docs/agent-lessons/library')), 'lite example leaves lessons unseeded');
  });
});

check('switching lite → full → lite via update prunes and restores cleanly', () => {
  const { runInstall, runVerify } = require('./commands');
  withTempProject(litePlus(), (into) => {
    const cfg = path.join(into, 'engsys.config.yaml');
    const agents = () => fs.readdirSync(path.join(into, '.claude/agents')).length;
    runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
    assert.strictEqual(agents(), 6);
    fs.writeFileSync(cfg, read(cfg).replace(/^profile:.*$/m, 'profile: full'));
    const up = runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'update' });
    assert.ok(up.pruned.some((p) => p.endsWith('skills/lenses/SKILL.md')), 'lite-only skill should be pruned');
    assert.ok(agents() > 6);
    const lock = JSON.parse(read(path.join(into, '.claude/engsys.lock')));
    assert.ok(!('profile' in lock), 'full lock carries no profile key');
    assert.ok(!('model' in JSON.parse(read(path.join(into, '.claude/settings.json')))));
    assert.ok(runVerify({ into, skipDoctor: true }).ok);
    fs.writeFileSync(cfg, read(cfg).replace(/^profile:.*$/m, 'profile: lite'));
    runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'update' });
    assert.strictEqual(agents(), 6);
    assert.ok(runVerify({ into, skipDoctor: true }).ok);
  });
});

check('lite adopting a project that pins its own model keeps it, and says so', () => {
  const { runInstall } = require('./commands');
  withTempProject(litePlus(), (into) => {
    fs.mkdirSync(path.join(into, '.claude'));
    fs.writeFileSync(path.join(into, '.claude/settings.json'), JSON.stringify({ model: 'opus' }));
    const r = runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
    assert.strictEqual(JSON.parse(read(path.join(into, '.claude/settings.json'))).model, 'opus');
    assert.ok(r.warnings.some((w) => /already sets model: "opus" — kept/.test(w)), r.warnings.join('\n'));
    // Once the engsys pin itself is in place, re-running update is quiet.
    fs.writeFileSync(path.join(into, '.claude/settings.json'), JSON.stringify({ model: 'sonnet' }));
    assert.deepStrictEqual(runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'update' }).warnings, []);
  });
});

// A lite install drops workflows, skills and agents the full set ships. Every
// pointer the remaining files keep into .claude/ must still resolve.
function danglingRefs(into, workerLayer) {
  const bad = [];
  // Commands/naturalize mention the worker layer under "if installed" wording,
  // so those paths may legitimately be absent when providers are off.
  const guarded = /^\.claude\/(scripts\/(providers\.json|worker-)|workflows\/(worker-dispatch\.md|briefs\/))/;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) files.push(p);
    }
  };
  walk(path.join(into, '.claude'));
  files.push(path.join(into, 'CLAUDE.md'));
  for (const f of files) {
    const text = read(f);
    const rel = path.relative(into, f);
    for (const m of text.matchAll(/\.claude\/(?:workflows|agents|commands|skills|scripts|hooks)\/([A-Za-z0-9_.\/-]*)([*<]?)/g)) {
      if (m[2]) continue;                                   // glob / placeholder
      const target = m[0].replace(/[.\/-]+$/, '');
      if (!workerLayer && guarded.test(target)) continue;
      if (!fs.existsSync(path.join(into, target))) bad.push(`${rel} -> ${target}`);
    }
    if (rel.startsWith('.claude')) {
      for (const m of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
        const link = m[1];
        if (/^(https?:|\.claude\/)/.test(link)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(f), link)) && !fs.existsSync(path.join(into, link))) bad.push(`${rel} -> ${link}`);
      }
    }
  }
  return bad;
}

check('lite install has no dangling references (with and without the worker layer)', () => {
  const { runInstall } = require('./commands');
  for (const extra of ['', '\n' + render.providersBlock(['codex', 'deepseek'])]) {
    withTempProject(litePlus(extra), (into) => {
      runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
      assert.deepStrictEqual(danglingRefs(into, !!extra), [], `dangling references${extra ? ' (providers on)' : ''}`);
    });
  }
});

check('lite install weighs far less than full (agents, always-loaded text)', () => {
  const { runInstall } = require('./commands');
  const measure = (cfgText) => withTempProject(cfgText, (into) => {
    runInstall({ engsysRoot: ENGSYS_ROOT, into, dryRun: false, mode: 'install' });
    const dirBytes = (d) => fs.readdirSync(path.join(into, d)).reduce((n, f) => n + fs.statSync(path.join(into, d, f)).size, 0);
    return { agents: dirBytes('.claude/agents'), commands: dirBytes('.claude/commands'), claude: fs.statSync(path.join(into, 'CLAUDE.md')).size };
  });
  const lite = measure(litePlus());
  const full = measure(litePlus().replace(/^profile:.*$/m, 'profile: full'));
  assert.ok(lite.agents < full.agents * 0.2, `agents ${lite.agents} vs ${full.agents}`);
  assert.ok(lite.commands < full.commands * 0.5, `commands ${lite.commands} vs ${full.commands}`);
  assert.ok(lite.claude < full.claude, `CLAUDE.md ${lite.claude} vs ${full.claude}`);
});

console.log(`\n${pass} checks passed.`);
