#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const html = fs.readFileSync(path.join(root, 'marketing/index.html'), 'utf8')
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const expectedVersion = '0.5.2'
const publicRelease = 'https://github.com/thomas92118/rabbit-interview-downloads/releases'

for (const file of [
  'marketing/public/hero-interview.jpg',
  'marketing/public/copilot-idle.jpg',
  'marketing/public/mock-interview.jpg',
  'marketing/public/resume-example.jpg',
]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing marketing asset: ${file}`)
}

for (const required of [
  '实时听懂问题，回答思路随时在眼前',
  'Deepgram API Key',
  'RabbitInterview-macOS-universal.dmg',
  'RabbitInterview-Windows-x64.exe',
  'SHA256SUMS.txt',
  '仅在明确允许辅助工具时使用',
]) {
  if (!html.includes(required)) throw new Error(`Missing marketing contract: ${required}`)
}

if (/[—–]/u.test(html)) throw new Error('Marketing copy contains a visible long dash')
if (packageJson.version !== expectedVersion || tauri.version !== expectedVersion) {
  throw new Error('Node and Tauri versions must match v0.5.2')
}
if (tauri.plugins.updater.endpoints[0] !== `${publicRelease}/latest/download/latest.json`) {
  throw new Error('Updater endpoint is not the public distribution repository')
}

console.log('marketing contract verified')
