'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSandboxedChildEnv } = require('../childProcessGuard');

test('buildSandboxedChildEnv: only allowlisted keys appear, sensitive keys never leak through', () => {
  const baseEnv = {
    HOME: '/Users/operator',
    USER: 'operator',
    LANG: 'en_US.UTF-8',
    GOOGLE_API_KEY: 'super-secret-key',
    SECRET_TOKEN: 'another-secret',
    SHELL: '/bin/zsh',
    npm_config_registry: 'https://registry.npmjs.org/',
    RANDOM_OTHER_VAR: 'value',
  };
  const result = buildSandboxedChildEnv(baseEnv, ['/usr/bin', '/bin']);

  assert.deepEqual(Object.keys(result).sort(), ['HOME', 'LANG', 'PATH', 'USER']);
  assert.equal(result.GOOGLE_API_KEY, undefined);
  assert.equal(result.SECRET_TOKEN, undefined);
  assert.equal(result.SHELL, undefined);
  assert.equal(result.npm_config_registry, undefined);
  assert.equal(result.RANDOM_OTHER_VAR, undefined);
});

test('buildSandboxedChildEnv: PATH is always present, built from pathParts not baseEnv.PATH', () => {
  const baseEnv = { PATH: '/should/not/be/used', HOME: '/h', USER: 'u', LANG: 'l' };
  const result = buildSandboxedChildEnv(baseEnv, ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']);
  assert.equal(result.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});

test('buildSandboxedChildEnv: PATH present even when pathParts is empty', () => {
  const result = buildSandboxedChildEnv({}, []);
  assert.equal(result.PATH, '');
  assert.equal('HOME' in result, false);
  assert.equal('USER' in result, false);
  assert.equal('LANG' in result, false);
});

test('buildSandboxedChildEnv: a missing optional key is fully absent, not set to undefined', () => {
  const baseEnv = { HOME: '/Users/operator', USER: 'operator' }; // no LANG
  const result = buildSandboxedChildEnv(baseEnv, ['/usr/bin']);

  assert.equal('LANG' in result, false);
  assert.equal(Object.keys(result).includes('LANG'), false);
  assert.deepEqual(Object.keys(result).sort(), ['HOME', 'PATH', 'USER']);
});

test('buildSandboxedChildEnv: all of HOME/USER/LANG missing leaves only PATH', () => {
  const result = buildSandboxedChildEnv({ SOME_OTHER: 'x' }, ['/bin']);
  assert.deepEqual(result, { PATH: '/bin' });
});

test('buildSandboxedChildEnv: does not mutate baseEnv or pathParts', () => {
  const baseEnv = { HOME: '/h', USER: 'u', LANG: 'l', SECRET: 's' };
  const pathParts = ['/bin', '/usr/bin'];
  const baseEnvCopy = { ...baseEnv };
  const pathPartsCopy = [...pathParts];

  buildSandboxedChildEnv(baseEnv, pathParts);

  assert.deepEqual(baseEnv, baseEnvCopy);
  assert.deepEqual(pathParts, pathPartsCopy);
});
