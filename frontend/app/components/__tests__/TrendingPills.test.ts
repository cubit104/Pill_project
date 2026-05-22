import test from 'node:test'
import assert from 'node:assert/strict'

import { formatTrendingLabel } from '../TrendingPills'

test('formats single-ingredient branded strength to concise label', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'plavix-300-1332',
      drug_name: 'Plavix',
      strength: 'CLOPIDOGREL BISULFATE 300 mg;',
    }),
    'Plavix 300 mg'
  )
})

test('supports plain dose-only strengths', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'brilinta-90',
      drug_name: 'Brilinta',
      strength: '90 mg',
    }),
    'Brilinta 90 mg'
  )
})

test('normalizes slash strengths with lower-case units', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'amoxicillin-clavulanate-1000-62-5',
      drug_name: 'Amoxicillin/Clavulanate',
      strength: '1000 MG/62.5 MG',
    }),
    'Amoxicillin/Clavulanate 1000 mg/62.5 mg'
  )
})

test('builds concise combo labels from verbose semicolon strengths', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'amoxicillin-clavulanate',
      drug_name: 'Amoxicillin and Clavulanate Potassium',
      strength:
        'AMOXICILLIN 562.5 mg;AMOXICILLIN SODIUM 437.5 mg;CLAVULANATE POTASSIUM 62.5 mg;',
    }),
    'Amoxicillin/Clavulanate 562.5/62.5 mg'
  )
})

test('falls back to title-cased slug when drug_name is missing', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'sertraline-hydrochloride-212-ig',
      drug_name: null,
      strength: '25 mg',
    }),
    'Sertraline Hydrochloride 25 mg'
  )
})

test('prefers matching ingredient segment for multi-segment strengths', () => {
  assert.equal(
    formatTrendingLabel({
      slug: 'bupropion-hydrochloride',
      drug_name: 'Bupropion Hydrochloride',
      strength: 'NALTREXONE HYDROCHLORIDE 90 mg;BUPROPION HYDROCHLORIDE 150 mg;',
    }),
    'Bupropion Hydrochloride 150 mg'
  )
})
