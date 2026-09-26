import test from 'node:test'
import assert from 'node:assert/strict'

import {
  nextIndex,
  photoCheck,
  pronunciationCheck,
  publishBlockers,
  publishWarnings,
  reviewKey,
  suggestedFlags,
  type PhotoRead,
  type Pronunciation,
  type QueueItem,
  type ReviewItem,
} from '../draftReview'

const said = (over: Partial<Pronunciation> = {}): Pronunciation => ({
  text: 'lye-SIN-oh-pril', source: 'manual', key: 'lisinopril', audio_url: null, problem: null, checked_by: null, checked_at: null, ...over,
})

const item = (over: Partial<ReviewItem> = {}, pill: Partial<ReviewItem['pill']> = {}): ReviewItem => ({
  pill: {
    id: 'p1', medicine_name: 'Lisinopril', brand_names: null, spl_strength: '10 mg', splimprint: 'M L 10', splcolor_text: 'PINK',
    splshape_text: 'ROUND', splsize: null, dosage_form: 'TABLET', route: 'ORAL', ndc11: null, ndc9: null, rxcui: '314077',
    author: null, status_rx_otc: 'Rx', dea_schedule_name: null, slug: null, image_filename: 'p1/a.avif', published: false,
    updated_at: '2026-09-25T09:00:00+00:00', ...pill,
  },
  photos: ['https://img/p1/a.avif'],
  warnings: [],
  indication: { text: 'Lisinopril is used to treat high blood pressure.', source: 'medlineplus', source_url: null },
  pronunciation: said(),
  flags: null,
  photo_read: null,
  ...over,
})

const read = (verdict: PhotoRead['verdict'], text = 'M L / 10'): PhotoRead => ({ verdict, read: text, confidence: 'high', model: 'm' })

test('the photo check says what the photo reads against what was typed', () => {
  assert.deepEqual(photoCheck(read('match'), 'M L 10'), { tone: 'ok', text: 'Photo reads M L / 10' })
  assert.equal(photoCheck(read('mismatch', 'L484'), 'M L 10').tone, 'bad')
  assert.match(photoCheck(read('mismatch', 'L484'), 'M L 10').text, /L484, not M L 10/)
  assert.equal(photoCheck(read('partial', '10'), 'M L 10').tone, 'warn')
  assert.equal(photoCheck(read('unreadable', ''), 'M L 10').tone, 'warn')
  assert.equal(photoCheck(null, 'M L 10').tone, 'none')
})

test('pronounced as: checked beats everything, a wrong-sounding one is red, a missing one never blocks', () => {
  assert.equal(pronunciationCheck(said({ checked_by: 'owner@test.com', problem: 'other_name' })).tone, 'ok')
  assert.match(pronunciationCheck(said({ text: 'ZES-tril', problem: 'other_name' })).text, /does not sound like "lisinopril"/i)
  assert.equal(pronunciationCheck(said({ source: 'medlineplus' })).tone, 'ok')
  assert.equal(pronunciationCheck(said()).tone, 'warn') // typed by the team, not checked yet
  assert.deepEqual(pronunciationCheck(said({ text: null, problem: 'missing' })), { tone: 'warn', text: 'No pronunciation saved' })
  assert.deepEqual(publishBlockers(item({ pronunciation: said({ text: null, problem: 'missing' }) })), [])
})

test('an empty "used for" blocks publishing; a doubtful photo only asks for a second press', () => {
  assert.deepEqual(publishBlockers(item()), [])
  assert.deepEqual(publishBlockers(item({ indication: null })), ['"What it\'s used for" is empty'])
  assert.match(publishBlockers(item({ indication: null }, { rxcui: null }))[0], /No RxCUI/)
  assert.deepEqual(publishBlockers(item({}, { published: true })), ['Already published'])
  assert.deepEqual(publishWarnings(item(), read('match')), [])
  assert.equal(publishWarnings(item(), read('mismatch', 'L484')).length, 1)
  assert.deepEqual(publishWarnings(item(), null), ['The photo has not been read'])
  assert.deepEqual(publishWarnings(item({ photos: [] }), null), ['This pill has no photo'])
})

test('F comes pre-ticked from what the checks found, keeping what the team was already told', () => {
  assert.deepEqual(suggestedFlags(item(), read('match')), [])
  assert.deepEqual(suggestedFlags(item(), read('mismatch', 'L484')), ['images', 'imprint'])
  assert.deepEqual(suggestedFlags(item({ indication: null }), read('partial', '10')), ['meds_use', 'imprint'])
  assert.deepEqual(suggestedFlags(item({ photos: [], flags: { missing: ['other'], note: null, flagged_by: null, flagged_at: null } }), null), ['images', 'other'])
})

test('the keys work anywhere but in a text box, and never with Ctrl held', () => {
  assert.equal(reviewKey({ key: 'p' }), 'publish')
  assert.equal(reviewKey({ key: 'F' }), 'flag')
  assert.equal(reviewKey({ key: 'ArrowRight' }), 'next')
  assert.equal(reviewKey({ key: 'ArrowLeft' }), 'prev')
  assert.equal(reviewKey({ key: 'e' }), 'edit')
  assert.equal(reviewKey({ key: 'p', target: { tagName: 'INPUT' } }), null)
  assert.equal(reviewKey({ key: 'p', target: { tagName: 'textarea' } }), null)
  assert.equal(reviewKey({ key: 'p', target: { tagName: 'DIV', isContentEditable: true } }), null)
  assert.equal(reviewKey({ key: 'p', ctrlKey: true }), null)
  assert.equal(reviewKey({ key: 'x' }), null)
})

test('moving through the queue skips what is done and, when asked, what was flagged back', () => {
  const q = (id: string, flagged = false): QueueItem => ({ id, medicine_name: id, strength: null, imprint: null, flagged, missing: [] })
  const queue = [q('a'), q('b', true), q('c'), q('d')]
  assert.equal(nextIndex(queue, -1, 1, true, new Set()), 0)
  assert.equal(nextIndex(queue, 0, 1, true, new Set()), 2) // b is flagged
  assert.equal(nextIndex(queue, 0, 1, false, new Set()), 1)
  assert.equal(nextIndex(queue, 0, 1, true, new Set(['c'])), 3) // c done this session
  assert.equal(nextIndex(queue, 3, 1, true, new Set()), -1)
  assert.equal(nextIndex(queue, 3, -1, true, new Set(['c'])), 0)
})
