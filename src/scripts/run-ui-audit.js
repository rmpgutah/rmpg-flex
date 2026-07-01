// src/scripts/run-ui-audit.js
/**
 * JavaScript version of the UI audit runner.
 * Mirrors the logic from src/utils/uiAudit.ts but without TypeScript typings.
 */
const fs = require('fs');
const path = require('path');

function isJSXFile(filePath) {
  return filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const issues = [];
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    // button without onClick
    if (/<button([^>]*?)>/i.test(line) && !/onClick\s*=/.test(line)) {
      issues.push({file: filePath, line: lineNum, type: 'button', message: 'Button missing onClick handler'});
    }
    // <a> without href or to
    if (/<a([^>]*?)>/i.test(line) && !/href\s*=/.test(line) && !/to\s*=/.test(line)) {
      issues.push({file: filePath, line: lineNum, type: 'link', message: 'Anchor missing href or to attribute'});
    }
    // onClick on non‑interactive element
    if (/onClick\s*=/.test(line) && !/(button|a|Link)/i.test(line)) {
      issues.push({file: filePath, line: lineNum, type: 'onClick', message: 'onClick used on non‑interactive element'});
    }
  });
  return issues;
}

function runAudit(rootDir) {
  const baseDir = rootDir || path.resolve(process.cwd(), 'client');
  const issues = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (isJSXFile(fullPath)) {
        issues.push(...scanFile(fullPath));
      }
    }
  }
  walk(baseDir);
  return issues;
}

function main() {
  const issues = runAudit();
  const outPath = path.resolve(process.cwd(), 'ui-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2), 'utf8');
  console.log(`✅ UI audit completed. ${issues.length} issue(s) found. Report written to ${outPath}`);
}

if (require.main === module) {
  main();
}
