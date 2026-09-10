import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DICT_DIR = join(SRC, 'i18n', 'es')

/** Keys defined in a dictionary file: 'text': '…' | Bare: '…' | "text": '…' */
const KEY_RE = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*:/gm
/** t('…') and tr("…") call sites, single or double quoted. */
const CALL_RE = /\btr?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const dictFiles = readdirSync(DICT_DIR).filter((f) => f.endsWith('.ts'))
const dictionaries = dictFiles.map((f) => ({ file: f, text: readFileSync(join(DICT_DIR, f), 'utf8') }))

function keysOf(text: string): string[] {
  return [...text.matchAll(KEY_RE)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'"))
}

const allKeys = new Set(dictionaries.flatMap((d) => keysOf(d.text)))

describe('Spanish dictionaries', () => {
  it('cover every t() call in the app', () => {
    const missing: string[] = []
    for (const file of walk(SRC)) {
      // The i18n module's own doc comment shows an example call.
      if (file.endsWith(join('lib', 'i18n.tsx'))) continue
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(CALL_RE)) {
        const key = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'")
        if (!allKeys.has(key)) missing.push(`${relative(SRC, file)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('never translate the same English key two different ways', () => {
    const seen = new Map<string, { file: string; value: string }>()
    const conflicts: string[] = []
    for (const { file, text } of dictionaries) {
      for (const m of text.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*\n?\s*'((?:[^'\\]|\\.)*)'/gm)) {
        const key = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'")
        const value = (m[4] ?? '').replace(/\\'/g, "'")
        const prev = seen.get(key)
        if (prev && prev.value !== value) conflicts.push(`${key}: ${prev.file}="${prev.value}" vs ${file}="${value}"`)
        else seen.set(key, { file, value })
      }
    }
    expect(conflicts).toEqual([])
  })

  it('keep every placeholder from the English key', () => {
    const broken: string[] = []
    for (const { file, text } of dictionaries) {
      for (const m of text.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*\n?\s*'((?:[^'\\]|\\.)*)'/gm)) {
        const key = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'")
        const value = m[4] ?? ''
        const want = [...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort()
        const got = [...value.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort()
        if (want.join(',') !== got.join(',')) broken.push(`${file}: "${key}" → "${value}"`)
      }
    }
    expect(broken).toEqual([])
  })
})

describe('translate', () => {
  it('falls back to the English text when a key is untranslated', () => {
    expect(translate('en', 'Cabinet')).toBe('Cabinet')
    expect(translate('es', 'Some string nobody translated')).toBe('Some string nobody translated')
  })

  it('translates a known key and fills placeholders', () => {
    expect(translate('es', 'Cabinet')).toBe('Botiquín')
    expect(translate('en', 'Side {n}', { n: 2 })).toBe('Side 2')
    expect(translate('es', 'Side {n}', { n: 2 })).toBe('Cara 2')
  })
})
