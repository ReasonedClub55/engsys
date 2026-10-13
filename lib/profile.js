'use strict';

// Install profiles. `full` (the default) is exactly the engsys that has always
// existed: every path below short-circuits on it. A named profile lives in
// profiles/<name>/ and overlays core/ — it supplies its own agents, commands,
// skills, templates and settings, and names the few core items it inherits.
// See docs/lite-profile.md.

const { path, exists, readText, fs } = require('./util');

const DEFAULT_PROFILE = 'full';

function listProfiles(engsysRoot) {
  const dir = path.join(engsysRoot, 'profiles');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(path.join(dir, d.name, 'profile.json')))
    .map((d) => d.name)
    .sort();
}

// -> { name, dir, def }. For `full`, dir and def are null (no overlay).
function resolveProfile(engsysRoot, config) {
  const name = String((config && config.profile) || DEFAULT_PROFILE);
  if (name === DEFAULT_PROFILE) return { name, dir: null, def: null };
  const dir = path.join(engsysRoot, 'profiles', name);
  const defPath = path.join(dir, 'profile.json');
  if (!exists(defPath)) {
    throw new Error(`unknown profile '${name}' — available: ${[DEFAULT_PROFILE, ...listProfiles(engsysRoot)].join(', ')}`);
  }
  let def;
  try { def = JSON.parse(readText(defPath)); } catch (e) {
    throw new Error(`invalid profiles/${name}/profile.json: ${e.message}`);
  }
  return { name, dir, def };
}

// First path in `candidates` that exists, else null.
function firstExisting(candidates) {
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

module.exports = { DEFAULT_PROFILE, listProfiles, resolveProfile, firstExisting };
