import test from 'node:test'
import assert from 'node:assert/strict'

import { approvalNames, firstMatches, isApprovalTitle, isDrugOrBiologic, isoFromWords, parseFdaPage, parseRss } from '../fda-announcements'
import { RECALLS_RSS, announcementPage, noticePage } from './fda-fixtures'

test('feed items: FDA links only, titles decoded, dates read', () => {
  const items = parseRss(RECALLS_RSS)
  assert.equal(items.length, 3)
  assert.equal(items[1].title, 'Par Health Issues Voluntary Nationwide Recall of Two Lots of Dexmedetomidine HCl & Saline')
  assert.equal(items[1].path, '/safety/recalls-market-withdrawals-safety-alerts/par-health-issues-recall')
  assert.equal(items[1].slug, 'par-health-issues-recall')
  assert.equal(items[1].date, '2026-09-18')
  assert.equal(isoFromWords('September 3, 2026'), '2026-09-03')
  assert.equal(isoFromWords('no date here'), '')
})

test('recall notice page: the FDA summary fields, not the scripts or the company text', () => {
  const page = parseFdaPage(noticePage('Drugs', 'Par Health Issues Voluntary Nationwide Recall'))
  assert.equal(page.title, 'Par Health Issues Voluntary Nationwide Recall')
  assert.equal(page.productType, 'Drugs')
  assert.equal(page.company, 'Par Health')
  assert.equal(page.brand, 'Par Pharmaceutical')
  assert.equal(page.product, 'Dexmedetomidine HCl in 0.9% Sodium Chloride Injection 400 mcg/100 mL')
  assert.equal(page.reason, 'Presence of particulate matter identified as cellulose')
  assert.equal(page.announced, '2026-09-18')
  assert.equal(page.published, '2026-09-21')
  assert.equal(page.date, '2026-09-18')
  assert.equal(page.summary, 'ROCHESTER, MI – September 18, 2026 – Par Health is voluntarily recalling two lots') // broken dashes mended
  assert.equal(parseFdaPage(noticePage('Food &amp; Beverages', 'x')).productType, 'Food & Beverages')
})

test('the whole page title wins over the shortened og:title', () => {
  const html = '<title>FDA approves lirafugratinib for previously treated, unresectable, locally advanced or metastatic cholangiocarcinoma | FDA</title>' +
    '<meta property="og:title" content="FDA approves lirafugratinib for previously treated, unresectable, loca" />'
  assert.equal(parseFdaPage(html).title, 'FDA approves lirafugratinib for previously treated, unresectable, locally advanced or metastatic cholangiocarcinoma')
})

test('announcement page: product type from "Regulated Product(s)"', () => {
  const page = parseFdaPage(announcementPage('FDA Approves First Gene Therapy', 'The FDA today approved Fayuvi (rebisufligene etisparvovec-hopf), the first treatment', 'Biologics'))
  assert.equal(page.productType, 'Biologics')
  assert.equal(page.date, '2026-09-17')
})

test('only drugs and biologics count, and only approvals', () => {
  assert.ok(isDrugOrBiologic('Drugs'))
  assert.ok(isDrugOrBiologic('Biologics'))
  assert.ok(!isDrugOrBiologic('Dietary Supplements'))
  assert.ok(!isDrugOrBiologic('Food & Beverages Allergens'))
  assert.ok(!isDrugOrBiologic('Medical Devices'))
  assert.ok(isApprovalTitle('FDA Approves First Gene Therapy for Pediatric Patients'))
  assert.ok(isApprovalTitle('FDA Grants Accelerated Approval to a New Breast Cancer Treatment'))
  assert.ok(isApprovalTitle('FDA approves lirafugratinib for cholangiocarcinoma'))
  assert.ok(!isApprovalTitle('FDA Issues Emergency Use Authorization for Drugs'))
  assert.ok(!isApprovalTitle('Oncology (Cancer)/Hematologic Malignancies Approval Notifications'))
})

test('the medicine named in an approval summary, in the FDA’s three wordings', () => {
  assert.deepEqual(approvalNames('The U.S. Food and Drug Administration today approved Fayuvi (rebisufligene etisparvovec-hopf), the first treatment'), {
    brand: 'Fayuvi',
    generic: 'rebisufligene etisparvovec-hopf',
  })
  assert.deepEqual(approvalNames('the Food and Drug Administration approved lirafugratinib (Lyrfigtu, Elevar Therapeutics, Inc.), a kinase inhibitor'), {
    brand: 'Lyrfigtu',
    generic: 'lirafugratinib',
  })
  assert.deepEqual(approvalNames('The FDA today granted accelerated approval to Tudriqev (vusolimogene oderparepvec-wtpg), a genetically modified'), {
    brand: 'Tudriqev',
    generic: 'vusolimogene oderparepvec-wtpg',
  })
  assert.equal(approvalNames('The FDA today expanded treatment options for adult patients with advanced breast cancer.'), null)
})

test('pages are read a few at a time, and no more once enough are found', async () => {
  const read: string[] = []
  const kept = await firstMatches(
    ['food', 'drug-1', 'drug-2', 'drug-3', 'drug-4', 'food-2'],
    async (item) => {
      read.push(item)
      return item.startsWith('drug') ? item : null
    },
    1,
    2,
  )
  assert.deepEqual(kept, ['drug-1'])
  assert.deepEqual(read, ['food', 'drug-1']) // one batch of two, then stop
  assert.deepEqual(await firstMatches(['a', 'b', 'c'], async (x) => x, 10, 2), ['a', 'b', 'c']) // fewer than asked: all of them
})
