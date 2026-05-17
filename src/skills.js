// Skill discovery — scans ~/.claude/skills and ~/.copilot/skills for SKILL.md files.
//
// Each valid skill directory must contain a SKILL.md with a YAML frontmatter block:
//   ---
//   name: <skill-name>
//   description: <one-line description>
//   argument-hint: [optional hint shown in popup]
//   ---
//
// Skills from the first matching directory win (no overwrite by later dirs).
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Default skills directory created by this extension on first activation.
const DEEPCOPILOT_SKILLS_DIR = path.join(os.homedir(), '.deepcopilot', 'skills');

// Directories scanned in order; first match wins for duplicate skill names.
const SKILL_DIRS = [
    DEEPCOPILOT_SKILLS_DIR,
    path.join(os.homedir(), '.claude',  'skills'),
    path.join(os.homedir(), '.copilot', 'skills'),
];

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Only handles simple scalar values (strings). No dependency on js-yaml.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseFrontmatter(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
        // Match:  key: value   or   key: "value"
        const kv = line.match(/^([\w-]+):\s*"?(.*?)"?\s*$/);
        if (kv) out[kv[1]] = kv[2];
    }
    return out;
}

/**
 * Scan all SKILL_DIRS and return an array of discovered skills.
 * @returns {{ name: string, desc: string, hint: string, content: string }[]}
 */
function discoverSkills() {
    const result = [];
    const seen   = new Set();

    for (const dir of SKILL_DIRS) {
        try { if (!fs.existsSync(dir)) continue; } catch { continue; }

        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const mdPath = path.join(dir, entry.name, 'SKILL.md');
            try {
                if (!fs.existsSync(mdPath)) continue;
                const content = fs.readFileSync(mdPath, 'utf8');
                const fm      = parseFrontmatter(content);
                const name    = (fm.name || entry.name).trim();
                if (!name || seen.has(name)) continue;
                seen.add(name);
                result.push({
                    name,
                    desc:    fm.description || '',
                    hint:    fm['argument-hint'] || '',
                    content,
                });
            } catch { /* skip broken entries silently */ }
        }
    }

    return result;
}

module.exports = { discoverSkills, DEEPCOPILOT_SKILLS_DIR };
