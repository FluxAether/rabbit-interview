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
const systemd = path.join(directory, 'systemd')
const unit = path.join(systemd, 'oncue-gateway.service')
const override = (name) => path.join(systemd, `${name}.service.d/zz-oncue-deploy.conf`)
const payload = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff, 0x0a])
const hasSystemdAnalyzer = spawnSync('systemd-analyze', ['--version']).status === 0
function verifyUnit(name) {
  if (!hasSystemdAnalyzer) return
  const result = spawnSync('systemd-analyze', ['verify', '--man=no', path.join(systemd, `${name}.service`)], {
    encoding: 'utf8',
    env: { ...process.env, SYSTEMD_UNIT_PATH: `${systemd}:` },
  })
  assert.equal(result.status, 0, result.stderr)
}
const shell = `
set -euo pipefail
remote_command() {
  if [ "\${AS_ROOT:-}" != 1 ]; then
    echo "$1: Permission denied" >&2
    return 1
  fi
  local args=() value
  for value in "$@"; do
    case "$value" in /etc/systemd/system*) value="$SYSTEMD_DIR\${value#/etc/systemd/system}" ;; esac
    args+=("$value")
  done
  command "\${args[@]}"
}
sudo() {
  [ "$1" = -n ] || { echo 'sudo must be non-interactive' >&2; return 1; }
  [ "\${FAIL_SUDO:-}" != 1 ] || { echo 'sudo: a password is required' >&2; return 1; }
  shift
  AS_ROOT=1 "$@"
}
mkdir() { remote_command mkdir "$@"; }
tee() {
  if [ "\${FAIL_UPLOAD:-}" = 1 ] || { [ "\${FAIL_UNIT_UPLOAD:-}" = 1 ] && [[ "\${!#}" = *.conf.new ]]; }; then
    printf 'partial binary' | remote_command tee "$@"
    return 1
  fi
  remote_command tee "$@"
}
chmod() { remote_command chmod "$@"; }
mv() { remote_command mv "$@"; }
systemctl() {
  [ "\${AS_ROOT:-}" = 1 ]
  local name="\${!#}" service dropin
  service="$SYSTEMD_DIR/\${name%.service}.service"
  dropin="$service.d/zz-oncue-deploy.conf"
  case "$1" in
    show)
      if [ -f "$service.masked" ]; then echo masked
      elif [ -f "$service" ]; then echo loaded
      else echo not-found; fi
      ;;
    daemon-reload)
      for name in oncue-gateway rabbit-gateway; do
        service="$SYSTEMD_DIR/$name.service"
        dropin="$service.d/zz-oncue-deploy.conf"
        [ ! -f "$service" ] || command cp "$service" "$service.loaded"
        [ ! -f "$dropin" ] || command cp "$dropin" "$dropin.loaded"
      done
      ;;
    enable|restart)
      if [ ! -f "$service" ]; then
        echo "Failed to restart \${name%.service}.service: Unit \${name%.service}.service not found." >&2
        return 5
      fi
      command cmp -s "$service" "$service.loaded" || return 1
      command cmp -s "$dropin" "$dropin.loaded" || return 1
      if [ "$1" = enable ]; then
        : > "$service.enabled"
      else
        [ -f "$service.enabled" ] || return 1
        printf '%s\\n' "$*" >> "$RESTART_LOG"
      fi
      ;;
    *) echo "Unexpected systemctl command: $*" >&2; return 1 ;;
  esac
}
ssh() { bash -euo pipefail -c "\${!#}"; }
scp() { echo 'scp cannot write the protected directory' >&2; return 1; }
export -f remote_command sudo mkdir tee chmod mv systemctl ssh scp
${upload}
`

try {
  mkdirSync(path.join(directory, 'dist-server'))
  writeFileSync(path.join(directory, 'dist-server/oncue-gateway'), payload)
  mkdirSync(deployPath)
  writeFileSync(path.join(deployPath, '.env'), '# provisioned server configuration\n')
  const run = (extra = {}) => {
    mkdirSync(systemd, { recursive: true })
    return spawnSync('bash', ['-c', shell], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, DEPLOY_HOST: 'example.invalid', DEPLOY_USER: 'deployer', DEPLOY_PORT: '22', DEPLOY_PATH: deployPath, RESTART_LOG: log, SYSTEMD_DIR: systemd, ...extra },
    })
  }

  const deployed = run()
  assert.equal(deployed.status, 0, deployed.stderr)
  assert.deepEqual(readFileSync(binary), payload, 'uploaded bytes must be preserved')
  assert.equal(statSync(binary).mode & 0o777, 0o755)
  assert.equal(existsSync(`${binary}.new`), false)
  assert.equal(readFileSync(log, 'utf8'), 'restart oncue-gateway\n')
  assert.ok(readFileSync(unit, 'utf8').includes(`User=deployer\nWorkingDirectory=${deployPath}/\n`))
  assert.equal(readFileSync(override('oncue-gateway'), 'utf8'), `[Service]\nExecStart=\nExecStart=:/bin/sh -c 'exec "$1"' -- "${deployPath}/oncue-gateway"\n`)
  verifyUnit('oncue-gateway')
  rmSync(log)

  const existingUnit = '[Service]\nUser=existing-gateway\nWorkingDirectory=/legacy/gateway\nEnvironmentFile=/etc/gateway.env\nExecStart=/legacy/gateway/rabbit-gateway\n[Install]\nWantedBy=multi-user.target\n'
  writeFileSync(unit, existingUnit)
  const repeated = run()
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(readFileSync(unit, 'utf8'), existingUnit, 'existing service settings must be preserved')
  rmSync(log)

  rmSync(systemd, { recursive: true })
  const quotedPath = path.join(directory, 'protected dir\'s $literal %n "quoted"\\tail')
  mkdirSync(quotedPath)
  writeFileSync(path.join(quotedPath, '.env'), '# provisioned server configuration\n')
  const quoted = run({ DEPLOY_PATH: quotedPath })
  assert.equal(quoted.status, 0, quoted.stderr)
  assert.deepEqual(readFileSync(path.join(quotedPath, 'oncue-gateway')), payload)
  const escapedPath = quotedPath.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  assert.equal(readFileSync(override('oncue-gateway'), 'utf8'), `[Service]\nExecStart=\nExecStart=:/bin/sh -c 'exec "$1"' -- "${escapedPath}/oncue-gateway"\n`)
  assert.ok(readFileSync(unit, 'utf8').includes(`WorkingDirectory=${quotedPath.replaceAll('%', '%%')}/\n`))
  verifyUnit('oncue-gateway')
  rmSync(log)

  rmSync(systemd, { recursive: true })
  mkdirSync(systemd)
  const legacyUnit = path.join(systemd, 'rabbit-gateway.service')
  writeFileSync(legacyUnit, existingUnit)
  const legacy = run()
  assert.equal(legacy.status, 0, legacy.stderr)
  assert.equal(readFileSync(legacyUnit, 'utf8'), existingUnit)
  assert.equal(existsSync(unit), false, 'legacy deployments must not start a second gateway')
  assert.ok(readFileSync(override('rabbit-gateway'), 'utf8').includes(`${deployPath}/oncue-gateway`), 'legacy service must start the new binary')
  assert.equal(readFileSync(log, 'utf8'), 'restart rabbit-gateway\n')
  verifyUnit('rabbit-gateway')
  rmSync(log)

  for (const failure of ['FAIL_UPLOAD', 'FAIL_SUDO']) {
    writeFileSync(binary, 'previous binary')
    const result = run({ [failure]: '1' })
    assert.notEqual(result.status, 0, `${failure} must fail deployment`)
    assert.equal(readFileSync(binary, 'utf8'), 'previous binary', `${failure} must preserve the running binary`)
    assert.equal(existsSync(log), false, `${failure} must not restart the service`)
  }
  const previousOverride = readFileSync(override('rabbit-gateway'), 'utf8')
  const interruptedUnit = run({ FAIL_UNIT_UPLOAD: '1' })
  assert.notEqual(interruptedUnit.status, 0, 'interrupted service configuration upload must fail deployment')
  assert.equal(readFileSync(override('rabbit-gateway'), 'utf8'), previousOverride)
  assert.equal(existsSync(log), false)
  writeFileSync(`${unit}.masked`, '')
  const masked = run()
  assert.notEqual(masked.status, 0, 'a masked service must not be overwritten or bypassed')
  assert.match(masked.stderr, /LoadState=masked/)
  assert.equal(existsSync(log), false)

  rmSync(systemd, { recursive: true })
  rmSync(path.join(deployPath, '.env'))
  const currentBinary = readFileSync(binary)
  const missingConfig = run()
  assert.notEqual(missingConfig.status, 0, 'first deployment requires provisioned runtime configuration')
  assert.match(missingConfig.stderr, /Prepare .*\.env readable by deployer/)
  assert.deepEqual(readFileSync(binary), currentBinary)
  assert.equal(existsSync(log), false)
  console.log('server deploy verified: first install, existing and legacy units, protected paths, reload/enable ordering, and failure handling')
  if (hasSystemdAnalyzer) console.log('systemd-analyze verified the generated service units and drop-ins')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
