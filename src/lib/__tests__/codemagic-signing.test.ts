// How the iOS builds get their signing profiles (T-1076): both Codemagic workflows go through
// scripts/codemagic/app-store-profiles.sh, and a pushed tag starts each. The script is run here with a stand-in
// for the `app-store-connect` tool that keeps what "Apple" has in a folder, so what it asks Apple for is seen.
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'scripts/codemagic/app-store-profiles.sh');
const yaml = fs.readFileSync(path.join(root, 'codemagic.yaml'), 'utf8').replace(/\r\n/g, '\n');

// One workflow of codemagic.yaml, from its key to the next one
function workflow(key: string): string {
  const start = yaml.indexOf(`\n  ${key}:\n`);
  if (start < 0) throw new Error(`No workflow ${key}`);
  const next = yaml.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? yaml.slice(start) : yaml.slice(start, start + 1 + next);
}

const BUNDLES = ['com.sinhgiang.wispramobile', 'com.sinhgiang.wispramobile.keyboard', 'com.sinhgiang.wispramobile.recording'];
const PROFILE_NAMES = ['Wispra App Store', 'Wispra Keyboard App Store', 'Wispra Recording App Store'];

const hasBash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
const describeWithBash = hasBash ? describe : describe.skip;

describe('the Codemagic workflows (T-1076)', () => {
  it('the profile workflow is started by a pushed profile-* tag, as the TestFlight one is by build-*', () => {
    const w = workflow('ios-create-profile');
    expect(w).toMatch(/triggering:\n {6}events:\n {8}- tag\n {6}tag_patterns:\n {8}- pattern: 'profile-\*'\n {10}include: true/);
    expect(workflow('ios-testflight')).toMatch(/pattern: 'build-\*'/);
    // The other workflow that only checks the build is still started by hand
    expect(workflow('ios-unsigned')).not.toMatch(/triggering:/);
  });

  it('both run the same script, so the list of profiles is in one place', () => {
    expect(workflow('ios-create-profile')).toContain('bash scripts/codemagic/app-store-profiles.sh\n');
    expect(workflow('ios-testflight')).toContain('bash scripts/codemagic/app-store-profiles.sh --save');
  });

  it('TestFlight fetches the profiles before anything reads them, and no longer relies on stored ones', () => {
    const w = workflow('ios-testflight');
    const fetchAt = w.indexOf('app-store-profiles.sh --save');
    // The step that reads the installed profiles for the team id, and the one that applies them
    expect(fetchAt).toBeGreaterThan(0);
    expect(fetchAt).toBeLessThan(w.indexOf('Provisioning Profiles/"*.mobileprovision'));
    expect(fetchAt).toBeLessThan(w.indexOf('xcode-project use-profiles'));
    // Only the certificate comes from what is stored in Codemagic; a profile is named nowhere
    expect(w).not.toMatch(/provisioning_profiles:|certificates:|wispra-app-store|wispra-keyboard-app-store/);
    expect(w).toMatch(/ios_signing:\n\s+# [^\n]*\n(\s+#[^\n]*\n)+\s+distribution_type: app_store/);
  });

  it('never names, reads or prints a key', () => {
    const text = fs.readFileSync(script, 'utf8').replace(/^\s*#.*$/gm, '');
    expect(text).not.toMatch(/PRIVATE_KEY|\.p8|--private-key|--key-id|--issuer-id|printenv|\benv\b\s*$/m);
    expect(text).not.toMatch(/echo[^\n]*\$\{?[A-Z_]*(KEY|SECRET|TOKEN)/);
  });

  it('the bundle ids of the app and of every extension the app has are in the script', () => {
    const text = fs.readFileSync(script, 'utf8');
    for (const id of BUNDLES) expect(text).toContain(id);
    // Each extension target of the project has an entry: the keyboard and the recording indicator
    for (const dir of ['keyboard', 'recording']) {
      expect(fs.readFileSync(path.join(root, 'targets', dir, 'expo-target.config.js'), 'utf8')).toMatch(/bundleIdentifier: '\.(keyboard|recording)'/);
      expect(text).toContain(`com.sinhgiang.wispramobile.${dir}`);
    }
  });
});

describeWithBash('scripts/codemagic/app-store-profiles.sh, with a stand-in for App Store Connect', () => {
  let dir: string;
  let bin: string;
  let apple: string;
  let saved: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wispra-signing-'));
    bin = path.join(dir, 'bin');
    apple = path.join(dir, 'apple');
    saved = path.join(dir, 'saved');
    fs.mkdirSync(bin);
    fs.mkdirSync(apple);
    // Stands in for `app-store-connect`: Apple's state is files in `apple`, every call is written to `calls`
    fs.writeFileSync(
      path.join(bin, 'app-store-connect'),
      `#!/bin/bash
echo "$*" >> "${dir.replace(/\\/g, '/')}/calls"
A="${apple.replace(/\\/g, '/')}"
name() { while [ $# -gt 0 ]; do if [ "$1" = "--name" ]; then echo "$2"; return; fi; shift; done; }
ident() { while [ $# -gt 0 ]; do if [ "$1" = "--bundle-id-identifier" ]; then echo "$2"; return; fi; shift; done; }
case "$1 $2" in
  "certificates list")
    if [ -f "$A/no-certificate" ]; then echo "[]"; else echo '[{"id":"CERT1","attributes":{"expirationDate":"2999-01-01T00:00:00Z"}}]'; fi ;;
  "profiles list")
    n=$(name "$@")
    if [ -f "$A/profile-$n" ]; then
      echo '[{"id":"PROF","attributes":{"expirationDate":"2999-01-01T00:00:00Z"}}]'
      case " $* " in *" --save "*) d=""; while [ $# -gt 0 ]; do [ "$1" = "--profiles-dir" ] && d="$2"; shift; done; mkdir -p "$d"; : > "$d/$n.mobileprovision";; esac
    else echo "[]"; fi ;;
  "profiles create") shift 2; b="$1"; n=$(name "$@"); : > "$A/profile-$n"; echo "$b" >> "$A/profile-for-bundle-id" ;;
  "bundle-ids list") i=$(ident "$@"); if [ -f "$A/bundle-$i" ]; then echo '[{"id":"BUNDLE-'"$i"'"}]'; else echo "[]"; fi ;;
  "bundle-ids create") : > "$A/bundle-$3" ;;
esac
`,
      { mode: 0o755 },
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PROFILES_DIR: saved },
    });
  const calls = () => (fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').split('\n').filter(Boolean) : []);

  it('registers every missing bundle id and makes every missing profile, tied to the certificates', () => {
    const result = run();
    expect(result.status).toBe(0);
    const made = calls().filter((c) => c.startsWith('profiles create'));
    expect(made).toHaveLength(3);
    for (const name of PROFILE_NAMES) expect(made.some((c) => c.includes(`--name ${name}`) && c.includes('--certificate-ids CERT1') && c.includes('--type IOS_APP_STORE'))).toBe(true);
    for (const id of BUNDLES) expect(calls().some((c) => c.startsWith('bundle-ids create') && c.includes(id))).toBe(true);
    // Without --save nothing is written to the build machine
    expect(fs.existsSync(saved)).toBe(false);
  });

  it('leaves the profiles that are already there alone', () => {
    for (const name of PROFILE_NAMES) fs.writeFileSync(path.join(apple, `profile-${name}`), '');
    const result = run();
    expect(result.status).toBe(0);
    expect(calls().filter((c) => c.startsWith('profiles create') || c.startsWith('bundle-ids create'))).toEqual([]);
    expect(result.stdout).toContain("The profile 'Wispra Recording App Store' already exists.");
  });

  it('a new extension needs only its line: with --save, the profile that was just made is saved where Xcode reads it', () => {
    const result = run('--save');
    expect(result.status).toBe(0);
    expect(fs.readdirSync(saved).sort()).toEqual(PROFILE_NAMES.map((n) => `${n}.mobileprovision`).sort());
    // Saved after it was made, and the folder is the one the build reads
    const list = calls();
    const madeAt = list.findIndex((c) => c.startsWith('profiles create') && c.includes('Wispra Recording App Store'));
    const savedAt = list.findIndex((c) => c.startsWith('profiles list') && c.includes('Wispra Recording App Store') && c.includes('--save'));
    expect(madeAt).toBeGreaterThanOrEqual(0);
    expect(savedAt).toBeGreaterThan(madeAt);
  });

  it('stops, and makes nothing, when the account has no distribution certificate', () => {
    fs.writeFileSync(path.join(apple, 'no-certificate'), '');
    const result = run('--save');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('No valid distribution certificate');
    expect(calls().some((c) => c.startsWith('profiles create'))).toBe(false);
  });

  it('stops when Apple refuses (the error is not swallowed, so a build does not go on without profiles)', () => {
    const refusing = fs.readFileSync(path.join(bin, 'app-store-connect'), 'utf8').replace('case "$1 $2" in', 'echo "403 PLA Update available" >&2; exit 1\ncase "$1 $2" in');
    fs.writeFileSync(path.join(bin, 'app-store-connect'), refusing, { mode: 0o755 });
    const result = run('--save');
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(saved)).toBe(false);
  });
});
