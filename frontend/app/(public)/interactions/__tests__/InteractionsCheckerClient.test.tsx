import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../InteractionsCheckerClient.tsx', import.meta.url)

test('interactions checker source renders summary as responsive stat chips', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /<p className="font-semibold text-slate-900">Summary<\/p>/)
  assert.match(source, /className="mt-3 flex flex-wrap gap-2"/)
  assert.match(source, /label: 'major'/)
  assert.match(source, /label: 'moderate'/)
  assert.match(source, /label: 'minor'/)
  assert.match(source, /label: 'food interactions'/)
  assert.match(source, /label: 'condition warnings'/)
  assert.match(source, /const muted = item\.count === 0/)
  assert.ok(source.includes('inline-flex min-w-[9.5rem] items-center gap-3 rounded-full border px-3 py-2'))
})

test('interactions checker source trims description and keeps it before interaction and management', () => {
  const source = readFileSync(sourcePath, 'utf8')

  assert.match(source, /const trimmedDescription = item\.description\?\.trim\(\)/)
  assert.match(source, /let description = trimmedDescription/)
  assert.match(source, /if \(!description && \(severity === 'major' \|\| severity === 'moderate'\)\)/)
  assert.match(source, /severity === 'major' \|\| severity === 'moderate'/)
  assert.match(source, /\{description && \(/)
  assert.match(source, /rounded-md border border-white\/60 bg-white\/40 px-3 py-3/)
  assert.match(source, /text-base font-medium leading-7 \$\{style\.text\}`\}>\{description\}/)

  const descriptionIndex = source.indexOf('>{description}</p>')
  const interactionIndex = source.indexOf('Interaction: </span>{item.interaction_text}')
  const managementIndex = source.indexOf('Management:</p>')

  assert.notEqual(descriptionIndex, -1)
  assert.notEqual(interactionIndex, -1)
  assert.notEqual(managementIndex, -1)
  assert.ok(descriptionIndex < interactionIndex)
  assert.ok(interactionIndex < managementIndex)
})
