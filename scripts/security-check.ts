import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const allowedEnvironmentFiles = new Set(['.env.example']);
const privateKeyExtensions = new Set(['.key', '.p12', '.pfx', '.pem']);
const binaryExtensions = new Set(['.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.webp']);

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const findings: string[] = [];
const secretPatterns = [
  new RegExp('-'.repeat(5) + 'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY' + '-'.repeat(5)),
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
];

for (const file of trackedFiles) {
  const normalized = file.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1) ?? normalized;
  const extension = extname(basename).toLowerCase();

  if (
    (basename === '.env' || basename.startsWith('.env.')) &&
    !allowedEnvironmentFiles.has(basename)
  ) {
    findings.push(`${file}: tracked environment file`);
  }
  if (privateKeyExtensions.has(extension)) findings.push(`${file}: tracked private-key container`);
  if (binaryExtensions.has(extension)) continue;

  const contents = readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.test(contents))
      findings.push(`${file}: high-confidence secret signature ${pattern.source}`);
  }
}

if (findings.length > 0) {
  console.error('Security check failed:\n' + findings.map((finding) => `- ${finding}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Security check passed for ${trackedFiles.length} tracked files.`);
}
