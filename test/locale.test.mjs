// Locale parity: both dictionaries must be valid JSON with identical key sets,
// and every key used by the page must exist in both.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')

const [zhText, enText, clientSource] = await Promise.all([
  readFile(join(pkg, 'locale', 'zh.json'), 'utf8'),
  readFile(join(pkg, 'locale', 'en.json'), 'utf8'),
  readFile(join(pkg, 'client.js'), 'utf8'),
])

const zh = JSON.parse(zhText)
const en = JSON.parse(enText)

test('both locale files are valid JSON objects', () => {
  assert.equal(typeof zh, 'object')
  assert.equal(typeof en, 'object')
})

test('zh and en carry exactly the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('no dictionary value is empty', () => {
  for (const [lang, dict] of [['zh', zh], ['en', en]]) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${lang}.${key} is not a string`)
      assert.ok(value.length > 0, `${lang}.${key} is empty`)
    }
  }
})

test('no dictionary value carries a zero-width or BOM character', () => {
  const forbidden = /[\u200B\uFEFF]/
  for (const [lang, dict] of [['zh', zh], ['en', en]]) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(forbidden.test(value), false, `${lang}.${key} carries an invisible character`)
    }
  }
})

test('every key the page asks for exists in both dictionaries', () => {
  // Only the translator's own calls count: `h('div', …, t('key'))` shapes are
  // what the page renders, while a bare `t(...)` on another identifier is not.
  const used = new Set([...clientSource.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]))
  // Drop anything that never looks like a dictionary key (single words with no
  // namespace dot are element/attribute names in other helpers).
  const keys = [...used].filter((key) => key.includes('.'))
  assert.ok(keys.length > 20, `only ${keys.length} keys found in the source`)
  for (const key of keys) {
    assert.ok(Object.hasOwn(zh, key), `zh is missing ${key}`)
    assert.ok(Object.hasOwn(en, key), `en is missing ${key}`)
  }
})

test('the inline dictionaries in client.js match the locale files', () => {
  // The bundle ships its own copies so it works without the JSON files, but a
  // drifted copy would show the wrong language for one of the two sources.
  for (const [lang, dict] of [['zh', zh], ['en', en]]) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(
        clientSource.includes(`'${key}':`) || clientSource.includes(`"${key}":`),
        `${lang}.${key} is missing from client.js`,
      )
      const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      assert.ok(
        clientSource.includes(escaped) || clientSource.includes(value.replace(/'/g, '\u2019')),
        `${lang}.${key} text drifted between locale/${lang}.json and client.js`,
      )
    }
  }
})
