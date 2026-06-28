import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readVersionFromJson(relativePath: string): string | null {
  try {
    const filePath = path.resolve(__dirname, relativePath);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return typeof data.version === 'string' && data.version.trim() ? data.version : null;
  } catch {
    return null;
  }
}

export function getAppVersion(): string {
  return (
    readVersionFromJson('../../package.json') ||
    readVersionFromJson('../../../CHANGELOG.json') ||
    readVersionFromJson('../../../package.json') ||
    '0.0.0'
  );
}
