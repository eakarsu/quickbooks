#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const excluded = new Set(['node_modules', '.git', 'dist', 'coverage']);
const extensions = new Set(['.js', '.jsx', '.json', '.sh']);
const forbidden = [
  ['insecure JWT fallback', ['quickbooks-secret-key', '-change-in-production'].join('')],
  ['demo credential', ['Password', '123!'].join('')],
  ['non-cryptographic identifier', ['Math', '.random()'].join('')],
  ['destructive database bootstrap', ['unlinkSync', '(dbPath)'].join('')],
];
const findings = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name === 'package-lock.json') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (extensions.has(path.extname(entry.name))) {
      const body = fs.readFileSync(target, 'utf8');
      for (const [label, value] of forbidden) if (body.includes(value)) findings.push(`${path.relative(root, target)}: ${label}`);
    }
  }
}

visit(root);
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('Executable source policy checks passed');
