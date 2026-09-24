import test from 'node:test'
import assert from 'node:assert/strict'

import { switchesFrom } from '../fda-news-switches'

test('a card is off only when Admin → Settings says false', () => {
  assert.deepEqual(switchesFrom({ fda_news_recalls_enabled: false, fda_news_approvals_enabled: true }), { recall: false, approval: true, shortage: true })
  assert.deepEqual(switchesFrom({ photo_id_enabled: true }), { recall: true, approval: true, shortage: true }) // an older backend without the switches
  assert.deepEqual(switchesFrom(null), { recall: true, approval: true, shortage: true })
  assert.deepEqual(switchesFrom({ fda_news_shortages_enabled: 'false' }), { recall: true, approval: true, shortage: true }) // not a clear "off"
})
