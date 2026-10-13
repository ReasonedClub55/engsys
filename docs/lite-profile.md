# Lite profile

A second way to install engsys, for people on a limited Claude plan. Same repo, same installer,
one config line: `profile: lite`. The default (`profile: full`, or no `profile:` line) is the
engsys you already know — **byte-for-byte unchanged** (`npm test` pins this).

## Why: where the usage goes

Reading the full system, the expensive things are not the file sizes — they are what the commands
*start*:

| Cost driver | In `full` | In `lite` |
|---|---|---|
| **Opus by default** | 8 of 12 agents (leith, melvin, nyx, gary, marcelo, jody, otto, sandy) run on Opus | every agent runs on Sonnet; `model: sonnet` is pinned in `.claude/settings.json` |
| **Specialist fan-out** | `/generate-project` = 6 persona runs (two in parallel, twice) **+ 1 sanity-check subagent** | 0 subagents: the same checks run as inline *lenses* in your session |
| **Autonomous loops** | `/implement-project` walks phase after phase (courtesy pause every 3), each with a second, independent review, then runs the closeout ceremony | exactly **one phase per run**, then it stops and tells you how to continue |
| **Review layers** | local review (~2 passes) **+** independent reviewer (fresh Opus subagent, or two cross-family workers when `risk: high`) | one local review pass; independent review is opt-in (`--review` or `risk: high`) |
| **Design critique** | gary (Opus) + leith (Opus) + nyx/otto when relevant | one inline pass |
| **Closeout** | mines every PR's review comments across the project | reads the findings comments, writes ≤ 3 lessons for families that recurred ≥ 2×, none is fine |
| **Persona text re-read per spawn** | 5–19 KB each, ~110 KB across the roster | ~1.2 KB each, ~8 KB total |
| **Always-loaded text** | ~20 KB (`CLAUDE.md` + agent/skill/command descriptions) | ~10 KB |

Run `node scripts/footprint.mjs` to see the static numbers from real installs. They are
structural estimates of what is loaded, not billed usage — the agent/Opus/loop rows above are
where most of the real difference is.

## Using it

**New project**

```bash
node /path/to/engsys/install init --profile lite --into .   # scaffolds engsys.config.yaml
$EDITOR engsys.config.yaml                                   # stack, project name
node /path/to/engsys/install install --into .
```

**Existing project** — add `profile: lite` to its `engsys.config.yaml` and run `update`. Lite-only
differences are applied and files lite doesn't ship are pruned. To go back, delete the line (or set
`profile: full`) and run `update` again.

**Both at once** — the profile is per project. Use `full` on one repo and `lite` on another from the
same clone; nothing is global. (A project's own `engsys.config.yaml` decides.)

### What lite installs

- **Agents (6, all Sonnet):** isabelle (implement), bert (investigate/file), jody (plan), nyx
  (security), aaron (IaC/deploy), patricia (docs/ADRs). Condensed to the working rules; the
  personality prose is gone.
- **`lenses` skill** replacing leith, melvin, marcelo, gary, otto as agents: architecture/scale,
  testing, product/UX spec, design critique, quick security, LLM cost. Applied inline, on context
  you already have.
- **Commands (8):** `/generate-project`, `/implement-issue`, `/implement-project`, `/file-issue`,
  `/project-closeout`, `/design-critique` (lite rewrites), plus `/pre-push` and `/naturalize` as-is.
- **Skills:** the issue-tracker and stack packs you select, plus `code-review`, `git-commit`,
  `pre-push`, `webapp-testing`, `chrome-devtools`, `lenses`.
- **No workflow docs** (the commands are self-contained) — except `worker-dispatch` + briefs when
  you enable providers.
- Lessons are **not seeded** by default (`lessons.seed: false` in the lite example); agents only
  grep `docs/agent-lessons/` when relevant.

### What you give up

- No Merge Monster, `/design-audit`, `/design-audit-local`, or the `/prep-review*` family.
- No Opus specialists by default. The lenses are checklists, not a separate expert's judgment;
  for a hard architecture or security call, run it deliberately (`/model opus`, or `nyx`).
- No automatic multi-phase run, no automatic independent review, no automatic lessons mining.
  Lite never merges anything; you do.

## Knobs

```yaml
profile: lite
agents:
  core: all
  extra: [melvin]        # pull a full-catalog persona in by name (melvin is Opus; install warns)
commands: all            # or an explicit list; names missing from lite fall back to core
                         # (core commands expect the full roster — /design-audit calls leith, marcelo)
skills:
  extra: [refactor]      # extra core skills (gh-cli, refactor, github-actions, … are large reads)
lessons:
  seed: true             # opt back in to the seeded lessons library
```

- `.claude/settings.json` pins `"model": "sonnet"`. If you change it (e.g. to `opus`), `update`
  keeps your value.
- `/implement-project N --review` and `/generate-project … --deep` opt in to the heavier passes.

**The biggest lever beyond lite is not Claude at all.** If you have a ChatGPT plan, a DeepSeek key
or SuperGrok, `engsys enable-providers codex,deepseek --into .` lets implementation and the
independent review run on *their* quota. Lite is built to work with it: with a worker layer
installed, `/implement-project --review` sends the review to a non-Anthropic worker (Claude only
packages the diff and reads the verdict) instead of spawning a Sonnet reviewer.

## Keeping your fork contributable

Lite is additive. The only edits to existing code are small hooks that all short-circuit when
`profile` is `full`:

- new: `profiles/lite/`, `lib/profile.js`, `scripts/footprint.mjs`, this doc
- touched: `lib/manifest.js`, `lib/render.js`, `lib/commands.js`, `lib/util.js`, `install`,
  `package.json` (`files`), `README.md`

To send something upstream, branch from upstream as usual — you don't need to carry lite along:

```bash
git remote add upstream https://github.com/eric-sabe/engsys   # once; the README's upstream
git fetch upstream && git switch -c fix/something upstream/main
```

To pull upstream improvements into your lite branch: `git merge upstream/main`, then `npm test`
(it fails if `full` drifted or lite grew a dangling reference). Because lite uses a *curated* set,
new upstream agents/commands/skills reach `full` automatically but not lite; to see what to
consider adopting: `git diff <old>..upstream/main --stat -- core/`.

## Maintaining it

- A new lite agent/command/skill is just a file under `profiles/lite/{agents,commands,skills}/`.
  To inherit a core command or skill instead of copying it, add its name to `inherit` in
  `profiles/lite/profile.json`.
- Keep lite commands self-contained: `lib/selftest.js` fails on any `.claude/…` path or relative
  `.md` link that doesn't exist in a lite install (worker-layer paths are allowed only when
  providers are on, since the commands guard them with "if installed").
- Command `description:` lines are copied into `CLAUDE.md`, which loads every session — keep them
  short.
