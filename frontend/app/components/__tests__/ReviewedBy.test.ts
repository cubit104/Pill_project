import test from 'node:test'
import assert from 'node:assert/strict'
import { pickPreferredReviewer } from '../ReviewedBy'
import type { PublicReviewer } from '../../lib/reviewers'

const baseReviewer: PublicReviewer = {
  id: '1',
  slug: 'reviewer',
  name: 'Reviewer',
  credentials: null,
  role: null,
  specialty: null,
  bio: null,
  avatar_url: null,
  linkedin_url: null,
  education: null,
  same_as: null,
  license_info: null,
  is_active: true,
  created_at: null,
  updated_at: null,
}

test('pickPreferredReviewer prefers medical_reviewer when available', () => {
  const selected = pickPreferredReviewer([
    { ...baseReviewer, id: 'author-1', slug: 'author-1', role: 'author', name: 'Author' },
    { ...baseReviewer, id: 'med-1', slug: 'med-1', role: 'medical_reviewer', name: 'Medical Reviewer' },
  ])
  assert.equal(selected?.id, 'med-1')
})

test('pickPreferredReviewer falls back to first reviewer', () => {
  const selected = pickPreferredReviewer([
    { ...baseReviewer, id: 'author-1', slug: 'author-1', role: 'author', name: 'Author' },
    { ...baseReviewer, id: 'editor-1', slug: 'editor-1', role: 'editor', name: 'Editor' },
  ])
  assert.equal(selected?.id, 'author-1')
})
