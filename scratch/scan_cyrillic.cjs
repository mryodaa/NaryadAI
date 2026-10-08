const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== 'i18n' && file !== '__tests__') {
        results = results.concat(walk(fullPath));
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      if (!file.endsWith('.test.ts') && !file.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
  });
  return results;
}

const files = walk('apps/web/src');
const cyrillicRegex = /[\u0400-\u04FF]/;
const findings = {};

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const stripped = line.replace(/\/\/.*$/, '').trim();
    if (cyrillicRegex.test(stripped)) {
      if (!stripped.includes("lang === 'kk'") &&
          !stripped.includes("lang === 'en'") &&
          !stripped.includes("lang === 'ru'") &&
          !stripped.includes("lang === ") &&
          !stripped.includes("key === 'в'") &&
          !stripped.includes("Select language") &&
          !stripped.includes("1С")) {
        if (!findings[f]) findings[f] = [];
        findings[f].push({ line: idx + 1, text: stripped });
      }
    }
  });
});

console.log('=== SUMMARY OF FILES WITH CYRILLIC ===');
for (const [file, items] of Object.entries(findings)) {
  console.log(`${file}: ${items.length}`);
}

for (const [file, items] of Object.entries(findings)) {
  console.log(`\n=== ${file} (${items.length} lines) ===`);
  items.forEach(i => console.log(`  L${i.line}: ${i.text}`));
}
