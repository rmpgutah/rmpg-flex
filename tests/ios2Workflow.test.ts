import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(join(__dirname, '..', '.github', 'workflows', 'ios2-tests.yml'), 'utf8');

describe('ios2 CI builds packages that exist in git', () => {
  it('does not pass -project RMPGFlexConnect.xcodeproj to xcodebuild', () => {
    expect(workflow).not.toMatch(/-project\s+RMPGFlexConnect\.xcodeproj/);
  });

  it('builds CoreCarPlay from its Swift package for the iOS Simulator', () => {
    expect(workflow).toMatch(/working-directory:\s*ios2\/RMPGFlexConnect\/Packages\/CoreCarPlay/);
    expect(workflow).toMatch(/-scheme CoreCarPlay/);
    expect(workflow).toMatch(/generic\/platform=iOS Simulator/);
  });

  it('runs CoreCarPlay host tests in the swift-tests matrix', () => {
    expect(workflow).toMatch(/package:\s*\[[^\]]*CoreCarPlay/);
  });
});
