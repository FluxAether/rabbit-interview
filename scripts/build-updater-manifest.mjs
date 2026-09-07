#!/usr/bin/env node
/**
 * Build a Tauri static updater latest.json fragment or merged manifest.
 *
 * Usage:
 *   node scripts/build-updater-manifest.mjs fragment --os darwin|windows --target <rust-target> --version <ver> --notes <text> --out <path>
 *   node scripts/build-updater-manifest.mjs merge --version <ver> --notes <text> --pub-date <iso> --parts <a.json,b.json> --out latest.json
 */
import fs from 'node:fs'
import path from 'node:path'

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return process.argv[i + 1]
}

function readSig(filePath) {
  if (!fs.existsSync(filePath)) die(`missing signature: ${filePath}`)
  return fs.readFileSync(filePath, 'utf8').trim()
}

function findFirst(globs) {
  // tiny glob: only ** and * in basenames via recursive walk + endsWith/includes
  for (const pattern of globs) {
    const hits = walkMatch(process.cwd(), pattern)
    if (hits.length) return hits.sort()[0]
  }
  return null
}

function walkMatch(root, pattern) {
  // Convert simple patterns like:
  // src-tauri/target/foo/release/bundle/**/*.app.tar.gz
  const parts = pattern.split('/')
  const results = []
  function rec(dir, idx) {
    if (idx >= parts.length) return
    const part = parts[idx]
    if (part === '**') {
      // match zero or more dirs, then continue with remaining
      rec(dir, idx + 1)
      if (!fs.existsSync(dir)) return
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) rec(path.join(dir, ent.name), idx)
      }
      return
    }
    if (part.includes('*')) {
      if (!fs.existsSync(dir)) return
      const re = new RegExp('^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!re.test(ent.name)) continue
        const full = path.join(dir, ent.name)
        if (idx === parts.length - 1) {
          if (ent.isFile()) results.push(full)
        } else if (ent.isDirectory()) {
          rec(full, idx + 1)
        }
      }
      return
    }
    const next = path.join(dir, part)
    if (idx === parts.length - 1) {
      if (fs.existsSync(next) && fs.statSync(next).isFile()) results.push(next)
      return
    }
    if (fs.existsSync(next) && fs.statSync(next).isDirectory()) rec(next, idx + 1)
  }
  rec(root, 0)
  return results
}

function fragmentDarwin(target, version, notes, baseUrl) {
  const tar = findFirst([
    `src-tauri/target/${target}/release/bundle/macos/*.app.tar.gz`,
    'src-tauri/target/release/bundle/macos/*.app.tar.gz',
  ])
  if (!tar) die('darwin updater archive (.app.tar.gz) not found')
  const sig = readSig(`${tar}.sig`)
  // softprops renames spaces to dots in asset names
  const assetName = path.basename(tar).replaceAll(' ', '.')
  const url = `${baseUrl}/${assetName}`
  return {
    version,
    notes,
    platforms: {
      'darwin-aarch64': { signature: sig, url },
      'darwin-x86_64': { signature: sig, url },
    },
  }
}

function fragmentWindows(target, version, notes, baseUrl) {
  // Prefer NSIS setup.exe for in-app updates
  const nsis = findFirst([
    `src-tauri/target/${target}/release/bundle/nsis/*-setup.exe`,
    'src-tauri/target/release/bundle/nsis/*-setup.exe',
  ])
  const msi = findFirst([
    `src-tauri/target/${target}/release/bundle/msi/*.msi`,
    'src-tauri/target/release/bundle/msi/*.msi',
  ])
  const installer = nsis || msi
  if (!installer) die('windows updater installer (.exe/.msi) not found')
  const sigPath = `${installer}.sig`
  const sig = readSig(sigPath)
  const assetName = 'OnCue-Windows-x64.exe'
  const url = `${baseUrl}/${assetName}`
  return {
    version,
    notes,
    platforms: {
      'windows-x86_64': { signature: sig, url },
    },
  }
}

const cmd = process.argv[2]
if (!cmd || !['fragment', 'merge'].includes(cmd)) {
  die('usage: build-updater-manifest.mjs fragment|merge ...')
}

if (cmd === 'fragment') {
  const os = arg('os')
  const target = arg('target')
  const version = arg('version')
  const notes = arg('notes', `v${version}`)
  const out = arg('out', 'latest.fragment.json')
  const repo = arg('repo', 'FluxAether/rabbit-interview')
  const tag = arg('tag', `v${version}`)
  if (!os || !target || !version) die('fragment requires --os --target --version')
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`
  const data =
    os === 'darwin'
      ? fragmentDarwin(target, version, notes, baseUrl)
      : os === 'windows'
        ? fragmentWindows(target, version, notes, baseUrl)
        : die(`unsupported os: ${os}`)
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
  console.log(`wrote ${out}`)
  console.log(JSON.stringify(data.platforms, null, 2))
  process.exit(0)
}

// merge
const version = arg('version')
const notes = arg('notes', `v${version}`)
const pubDate = arg('pub-date', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))
const parts = (arg('parts') || '').split(',').map((s) => s.trim()).filter(Boolean)
const out = arg('out', 'latest.json')
if (!version || !parts.length) die('merge requires --version and --parts a.json,b.json')

const platforms = {}
for (const p of parts) {
  if (!fs.existsSync(p)) die(`missing part: ${p}`)
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  Object.assign(platforms, data.platforms || {})
}
if (!Object.keys(platforms).length) die('merged platforms empty')

const manifest = { version, notes, pub_date: pubDate, platforms }
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${out} with platforms: ${Object.keys(platforms).join(', ')}`)
