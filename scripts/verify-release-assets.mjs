#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const directory = path.resolve(process.argv[2] || 'dist-release')
const requiredFiles = [
  'RabbitInterview-macOS-universal.dmg',
  'RabbitInterview-Windows-x64.exe',
  'latest.json',
  'SHA256SUMS.txt',
]

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(directory, name))) throw new Error(`Missing release file: ${name}`)
}

const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'))
for (const platform of ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']) {
  const item = manifest.platforms?.[platform]
  if (!item?.signature || !item?.url) throw new Error(`Missing updater platform: ${platform}`)
  const url = new URL(item.url)
  if (url.hostname !== 'github.com' || !url.pathname.startsWith('/FluxAether/rabbit-interview/releases/download/')) {
    throw new Error(`Unexpected updater URL: ${item.url}`)
  }
  const asset = decodeURIComponent(url.pathname.split('/').at(-1))
  if (!fs.existsSync(path.join(directory, asset))) throw new Error(`Updater URL asset is absent: ${asset}`)
}

const checksums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
if (!checksums.length) throw new Error('SHA256SUMS.txt is empty')
for (const line of checksums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/)
  if (!match) throw new Error(`Invalid checksum row: ${line}`)
  const file = path.join(directory, match[2])
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`)
}

console.log(`release assets verified for ${manifest.version}`)
