#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const config = readFileSync(new URL('../.circleci/config.yml', import.meta.url), 'utf8')
const upload = config.match(/ {12}SSH_CMD=[\s\S]*?(?= {12}echo "Checking gateway health)/)?.[0]
assert.ok(upload, 'CircleCI server upload command must exist')

const directory = mkdtempSync(path.join(tmpdir(), 'oncue-deploy-'))
const deployPath = path.join(directory, 'protected')
const binary = path.join(deployPath, 'oncue-gateway')
const log = path.join(directory, 'restart.log')
const payload = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff, 0x0a])
const shell = `
set -euo pipefail
remote_command() {
  if [ "\${AS_ROOT:-}" != 1 ]; then
    echo "$1: Permission denied" >&2
    return 1
  fi
  command "$@"
}
sudo() {
  [ "$1" = -n ] || { echo 'sudo must be non-interactive' >&2; return 1; }
  [ "\${FAIL_SUDO:-}" != 1 ] || { echo 'sudo: a password is required' >&2; return 1; }
  shift
  AS_ROOT=1 "$@"
}
mkdir() { remote_command mkdir "$@"; }
tee() {
  if [ "\${FAIL_UPLOAD:-}" = 1 ]; then
    printf 'partial binary' | remote_command tee "$@"
    return 1
  fi
  remote_command tee "$@"
}
chmod() { remote_command chmod "$@"; }
mv() { remote_command mv "$@"; }
systemctl() {
  [ "\${AS_ROOT:-}" = 1 ]
  printf '%s\\n' "$*" >> "$RESTART_LOG"
}
ssh() { bash -euo pipefail -c "\${!#}"; }
scp() { echo 'scp cannot write the protected directory' >&2; return 1; }
export -f remote_command sudo mkdir tee chmod mv systemctl ssh scp
${upload}
`

try {
  mkdirSync(path.join(directory, 'dist-server'))
  writeFileSync(path.join(directory, 'dist-server/oncue-gateway'), payload)
  const run = (extra = {}) => spawnSync('bash', ['-c', shell], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, DEPLOY_HOST: 'example.invalid', DEPLOY_USER: 'deployer', DEPLOY_PORT: '22', DEPLOY_PATH: deployPath, RESTART_LOG: log, ...extra },
  })

  const deployed = run()
  assert.equal(deployed.status, 0, deployed.stderr)
  assert.deepEqual(readFileSync(binary), payload, 'uploaded bytes must be preserved')
  assert.equal(statSync(binary).mode & 0o777, 0o755)
  assert.equal(existsSync(`${binary}.new`), false)
  assert.equal(readFileSync(log, 'utf8'), 'restart oncue-gateway\n')
  rmSync(log)

  const quotedPath = path.join(directory, "protected dir's $literal")
  const quoted = run({ DEPLOY_PATH: quotedPath })
  assert.equal(quoted.status, 0, quoted.stderr)
  assert.deepEqual(readFileSync(path.join(quotedPath, 'oncue-gateway')), payload)
  rmSync(log)

  for (const failure of ['FAIL_UPLOAD', 'FAIL_SUDO']) {
    writeFileSync(binary, 'previous binary')
    const result = run({ [failure]: '1' })
    assert.notEqual(result.status, 0, `${failure} must fail deployment`)
    assert.equal(readFileSync(binary, 'utf8'), 'previous binary', `${failure} must preserve the running binary`)
    assert.equal(existsSync(log), false, `${failure} must not restart the service`)
  }
  console.log('server deploy verified: protected paths, binary integrity, atomic replacement, and failure handling')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
