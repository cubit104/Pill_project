import test from 'node:test'
import assert from 'node:assert/strict'

import { RECALLS_RSS, announcementPage, noticePage } from './fda-fixtures'
import {
  approvalNews,
  approvalsForNews,
  fdaHighlights,
  formNoun,
  genericName,
  groupShortages,
  labelUses,
  parseApproval,
  plainReason,
  recallNews,
  recallsForNews,
  shortFirm,
  shortProduct,
  shortageHeadline,
  shortageTag,
  slugify,
  titleIfShouting,
} from '../fda-news'

// rows as openFDA sends them (trimmed to the fields used)
const recallRow = (over: Record<string, unknown> = {}) => ({
  recall_number: 'D-0850-2026',
  event_id: '98001',
  classification: 'Class I',
  report_date: '20260916',
  recall_initiation_date: '20260828',
  recalling_firm: 'Baxter Healthcare Corporation',
  city: 'Deerfield',
  state: 'IL',
  country: 'United States',
  product_description: 'Dextrose Injection, USP, 70 %, 2000 mL bags, Rx Only, Baxter Healthcare Corporation Deerfield, IL, 60016, Made in USA, NDC 00338-0719-06',
  reason_for_recall: 'Presence of Particulate Matter: particulate matter identified as stainless steel particles in the solution.',
  code_info: 'Lot: G123456, Exp 3/2027',
  status: 'Ongoing',
  voluntary_mandated: 'Voluntary: Firm initiated',
  ...over,
})

const approvalRow = (over: Record<string, unknown> = {}) => ({
  application_number: 'NDA220359',
  sponsor_name: 'ASTRAZENECA PHARMACEUTICALS, LP',
  submissions: [{ submission_type: 'ORIG', submission_number: '1', submission_status: 'AP', submission_status_date: '20260904', submission_class_code: 'TYPE 1' }],
  products: [{ brand_name: 'ETCAMAH', active_ingredients: [{ name: 'CAMIZESTRANT', strength: '75MG' }], dosage_form: 'TABLET', route: 'FILM COATED', marketing_status: 'Prescription' }],
  openfda: { route: ['ORAL'], spl_set_id: ['c54223d3-f3c7-4186-afa0-429d84805826'] },
  ...over,
})

const shortageRow = (over: Record<string, unknown> = {}) => ({
  status: 'Current',
  generic_name: 'Pentostatin Injection',
  dosage_form: 'Injection',
  presentation: 'Nipent, Injection, 10 mg, single dose vial (NDC 0409-0801-01)',
  company_name: 'Hospira, Inc., a Pfizer Company',
  availability: 'Unavailable',
  shortage_reason: 'Other',
  related_info: 'Next delivery: Q2 2027',
  initial_posting_date: '08/27/2026',
  update_date: '08/27/2026',
  therapeutic_category: ['Oncology'],
  ...over,
})

test('company names are shortened the way people say them', () => {
  assert.equal(shortFirm('Hospira, Inc., a Pfizer Company'), 'Hospira')
  assert.equal(shortFirm('Baxter Healthcare Corporation'), 'Baxter Healthcare')
  assert.equal(shortFirm('ELI LILLY AND CO'), 'Eli Lilly')
  assert.equal(shortFirm('Empower Clinic Services, LLC dba Empower Pharmacy'), 'Empower Pharmacy')
  assert.equal(shortFirm('Ajanta Pharma USA Inc'), 'Ajanta Pharma USA')
})

test('capitals are softened only when the FDA text is shouting', () => {
  assert.equal(titleIfShouting('OPTIMAL BALANCE PHARMACY'), 'Optimal Balance Pharmacy')
  assert.equal(titleIfShouting('THE ONE SPF 50 INVISIBLE SUNSCREEN GEL, 3ml'), 'The One SPF 50 Invisible Sunscreen Gel, 3ml')
  assert.equal(titleIfShouting('traZODone Hydrochloride Tablets'), 'traZODone Hydrochloride Tablets') // FDA tall-man spelling kept
})

test('product descriptions are cut to the product itself', () => {
  assert.equal(shortProduct(recallRow().product_description, 'Baxter Healthcare Corporation'), 'Dextrose Injection, 70 %')
  assert.equal(
    shortProduct('Fluphenazine Hydrochloride Tablets, USP, 1mg, 100-count bottles, Rx Only, Marketed by: Ajanta Pharma USA Inc.', 'Ajanta Pharma USA Inc'),
    'Fluphenazine Hydrochloride Tablets, 1mg',
  )
  assert.equal(
    shortProduct('Clindamycin Injection USP in 5% Dextrose, 900 mg per 50 mL (12 mg/mL) in GALAXY 50 mL Single Dose Container, Rx only, Sterile', 'Baxter Healthcare Corporation'),
    'Clindamycin Injection in 5% Dextrose',
  )
  assert.equal(
    shortProduct('0.9% Sodium Chloride Injection USP 500 mL, VIAFLEX Plastic Containers, with 24 units per case. Baxter Healthcare Corporation, Deerfield', 'Baxter Healthcare Corporation'),
    '0.9% Sodium Chloride Injection 500 mL, VIAFLEX Plastic Containers',
  )
  // a bracket between two commas goes without leaving ",,"
  assert.equal(shortProduct("Broadway Joe's Pain Cream, (1500mg CBD Isolate), 2 oz jar, Lexia LLC", 'Lexia LLC'), "Broadway Joe's Pain Cream, 2 oz jar")
  // a thousands comma is not a separator
  assert.equal(shortProduct('fentaNYL Citrate, 1,000 mcg/100 mL (10mcg/mL) Injection solution in 100 mL, 0.9% NaCl Bag, OurPharma LLC', 'OurPharma LLC'), 'fentaNYL Citrate, 1,000 mcg/100 mL Injection solution in 100 mL')
})

test('reasons in plain words, and nothing when the reason is unusual', () => {
  assert.equal(plainReason('Presence of Particulate Matter: stainless steel'), 'particles found in the product')
  assert.equal(plainReason('CGMP Deviations'), 'manufacturing problems (CGMP)')
  assert.equal(plainReason('Failed impurities/degradation specifications: at the 18 months long term stability'), 'failed an impurity test')
  assert.equal(plainReason('Presence of Foreign Tablets/Capsules'), 'wrong tablets or capsules found in bottles')
  assert.equal(plainReason('Failed Tablet/Capsule Specifications'), '')
  assert.equal(plainReason('Microbial Contamination of Sterile Products'), 'possible contamination')
  assert.equal(plainReason('Lack of Assurance of Sterility'), 'sterility not assured')
  assert.equal(plainReason('Labeling: Label Mix-up'), 'labeling error')
  assert.equal(plainReason('Subpotent Drug: tested below the labeled strength'), 'strength not as labeled')
  assert.equal(plainReason('Temperature abuse'), '')
})

test('recalls: newest first, most serious first on the same day, one per recall event', () => {
  const rows = recallsForNews({
    results: [
      recallRow({ recall_number: 'D-1', event_id: 'A', classification: 'Class III', report_date: '20260916' }),
      recallRow({ recall_number: 'D-2', event_id: 'B', classification: 'Class I', report_date: '20260916' }),
      recallRow({ recall_number: 'D-3', event_id: 'B', classification: 'Class I', report_date: '20260916' }),
      recallRow({ recall_number: 'D-4', event_id: 'C', classification: 'Class I', report_date: '20260909' }),
      recallRow({ recall_number: '', event_id: 'D' }), // unusable row
    ],
  })
  assert.deepEqual(rows.map((r) => r.id), ['D-2', 'D-1', 'D-4'])
  assert.equal(rows[0].headline, 'Baxter Healthcare recalls Dextrose Injection, 70 %: particles found in the product')
  assert.equal(rows[0].place, 'Deerfield, IL, United States')
})

test('new drug approvals: only first-time approvals of new ingredients inside the window', () => {
  const old = approvalRow({
    application_number: 'NDA021880',
    submissions: [
      { submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20051227', submission_class_code: 'TYPE 1' },
      { submission_type: 'SUPPL', submission_status: 'AP', submission_status_date: '20260910' },
    ],
  })
  const notNew = approvalRow({ application_number: 'NDA220001', submissions: [{ submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20260910', submission_class_code: 'TYPE 5' }] })
  const biologic = approvalRow({
    application_number: 'BLA761463',
    sponsor_name: 'SCHOLAR ROCK INC',
    submissions: [{ submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20260911', submission_class_code: 'TYPE 1' }],
    products: [{ brand_name: 'ISEMBYLD', active_ingredients: [{ name: 'APITEGROMAB-MSTN', strength: '400MG' }], dosage_form: 'INJECTABLE', route: 'INJECTION' }],
    openfda: {},
  })
  const list = approvalsForNews({ results: [old, notNew, approvalRow(), biologic] }, '2026-07-25')
  assert.deepEqual(list.map((a) => a.application), ['BLA761463', 'NDA220359'])
  assert.equal(list[0].headline, 'FDA approves Isembyld (apitegromab-mstn) injection')
  assert.equal(list[1].headline, 'FDA approves Etcamah (camizestrant) tablets')
  assert.equal(list[1].date, '2026-09-04')
  assert.equal(list[1].setId, 'c54223d3-f3c7-4186-afa0-429d84805826')
  assert.equal(parseApproval({ application_number: 'NDA1', submissions: [] }), null)
})

test('ingredient names drop salts and keep radioactive labels readable', () => {
  assert.equal(genericName('ORFORGLIPRON CALCIUM'), 'orforglipron')
  assert.equal(genericName('BREPOCITINIB TOSYLATE'), 'brepocitinib')
  assert.equal(genericName('FLORETYROSINE F 18'), 'floretyrosine F 18')
  assert.equal(genericName('SODIUM CHLORIDE'), 'sodium chloride') // the first word is never dropped
  assert.equal(formNoun('POWDER', '', 'SUBCUTANEOUS'), 'injection')
  assert.equal(formNoun('SOLUTION', 'ORAL'), 'oral liquid')
  assert.equal(formNoun('KIT', ''), '')
})

test('shortages: grouped by drug, with honest headlines about what the makers report', () => {
  const groups = groupShortages({
    results: [
      shortageRow(),
      shortageRow({ generic_name: 'Ifosfamide Injection', company_name: 'Baxter Healthcare', availability: 'Unavailable', initial_posting_date: '06/12/2026', presentation: 'Ifosfamide, 1 g vial (NDC 1)' }),
      shortageRow({ generic_name: 'Ifosfamide Injection', company_name: 'Hikma Pharmaceuticals USA, Inc.', availability: 'Limited Availability', initial_posting_date: '06/12/2026', presentation: 'Ifosfamide, 3 g vial' }),
      shortageRow({ generic_name: 'Ifosfamide Injection', company_name: 'SteriMax, Inc.', availability: 'Available', initial_posting_date: '06/12/2026', presentation: 'Ifosfamide, 1 g vial' }),
      // the same product in another package size: shown once
      shortageRow({ generic_name: 'Ifosfamide Injection', company_name: 'SteriMax, Inc.', availability: 'Available', initial_posting_date: '06/12/2026', presentation: 'Ifosfamide, 1 g vial (NDC 2)' }),
      shortageRow({ generic_name: 'Dextrose Monohydrate 5% Injection', company_name: 'Baxter Healthcare', availability: 'Available', initial_posting_date: '07/20/2026' }),
      shortageRow({ generic_name: 'Dextrose Monohydrate 5% Injection', company_name: 'B. Braun Medical Inc.', availability: 'Available', initial_posting_date: '07/20/2026' }),
      shortageRow({ generic_name: 'Old Drug', status: 'Resolved' }),
    ],
  })
  assert.deepEqual(groups.map((g) => g.slug), ['pentostatin-injection', 'dextrose-monohydrate-5-injection', 'ifosfamide-injection'])
  const [pentostatin, dextrose, ifosfamide] = groups
  assert.equal(pentostatin.rows[0].presentation, 'Nipent, Injection, 10 mg, single dose vial') // NDC stripped
  assert.equal(shortageHeadline(pentostatin), 'Pentostatin Injection: Hospira reports it unavailable')
  assert.equal(shortageTag(pentostatin), 'Unavailable from maker')
  assert.equal(shortageHeadline(ifosfamide), 'Ifosfamide Injection shortage: 2 of 3 makers report limited or no supply')
  assert.equal(shortageTag(ifosfamide), 'Some makers out of stock')
  assert.equal(ifosfamide.rows[0].availability, 'unavailable') // worst first
  assert.equal(ifosfamide.rows.length, 3)
  assert.equal(shortageHeadline(dextrose), 'Dextrose Monohydrate 5% Injection: makers report supply is available again')
  assert.equal(shortageTag(dextrose), 'On the FDA shortage list')
  assert.equal(slugify('  Methylphenidate Film, Extended Release '), 'methylphenidate-film-extended-release')
})

test('label text loses its section heading and is cut at a sentence', () => {
  assert.equal(labelUses('1 INDICATIONS AND USAGE ETCAMAH is indicated for breast cancer.'), 'ETCAMAH is indicated for breast cancer.')
  assert.equal(
    labelUses('X is indicated, based on an FDA-authorized test [see Dosage and Administration ( 2.1 )] . This indication is approved.'),
    'X is indicated, based on an FDA-authorized test. This indication is approved.',
  )
  const long = labelUses(`INDICATIONS & USAGE ${'First sentence here. '.repeat(60)}`, 200)
  assert.ok(long.length <= 200 && long.endsWith('.'))
})

test('same-day FDA notices join the lists: drugs and biologics only, no duplicates, no new uses of old drugs', async () => {
  const originalFetch = global.fetch
  const answer = (body: string, status = 200) => new Response(body, { status })
  const json = (body: unknown) => answer(JSON.stringify(body))
  const press = (title: string, slug: string, date: string) =>
    `<item><title>${title}</title><link>http://www.fda.gov/news-events/press-announcements/${slug}</link><pubDate>${date}</pubDate></item>`
  const pages: Record<string, string> = {
    '/safety/recalls-market-withdrawals-safety-alerts/par-health-issues-recall': noticePage('Drugs', 'Par Health Issues Voluntary Nationwide Recall'),
    '/safety/recalls-market-withdrawals-safety-alerts/global-mix-inc-recalls-niwali-tejocote-capsules': noticePage('Dietary Supplements', 'Global Mix Recalls Tejocote'),
    '/safety/recalls-market-withdrawals-safety-alerts/gf-blends-recalls-flour': noticePage('Food &amp; Beverages', 'GF Blends Recalls Flour'),
    '/news-events/press-announcements/fayuvi': announcementPage('FDA Approves First Gene Therapy for Sanfilippo Syndrome', 'The FDA today approved Fayuvi (rebisufligene etisparvovec-hopf), the first', 'Biologics'),
    '/news-events/press-announcements/breast': announcementPage('FDA Grants Accelerated Approval to a New Breast Cancer Treatment', 'The FDA today approved Etcamah (camizestrant), a pill', 'Drugs', '2026-09-04'),
    '/news-events/press-announcements/keytruda': announcementPage('FDA Approves Keytruda for a New Cancer', 'The FDA today approved Keytruda (pembrolizumab) for adults with', 'Drugs', '2026-09-10'),
    '/news-events/press-announcements/pump': announcementPage('FDA Approves New Insulin Pump', 'The FDA today approved the Acme Pump (model 2), a device', 'Medical Devices', '2026-09-12'),
  }
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname === 'www.fda.gov') {
      if (url.pathname.endsWith('/recalls/rss.xml')) return answer(RECALLS_RSS)
      if (url.pathname.endsWith('/press-releases/rss.xml')) {
        return answer(`<rss><channel>${[
          press('FDA Approves First Gene Therapy for Sanfilippo Syndrome', 'fayuvi', 'Thu, 17 Sep 2026 14:30:00 EDT'),
          press('FDA Approves New Insulin Pump', 'pump', 'Sat, 12 Sep 2026 10:00:00 EDT'),
          press('FDA Approves Keytruda for a New Cancer', 'keytruda', 'Thu, 10 Sep 2026 10:00:00 EDT'),
          press('FDA Grants Accelerated Approval to a New Breast Cancer Treatment', 'breast', 'Fri, 04 Sep 2026 10:00:00 EDT'),
          press('FDA Launches a Pilot Program', 'pilot', 'Tue, 15 Sep 2026 10:00:00 EDT'),
        ].join('')}</channel></rss>`)
      }
      return pages[url.pathname] ? answer(pages[url.pathname]) : answer('', 404)
    }
    const search = decodeURIComponent(url.search)
    if (url.pathname === '/drug/enforcement.json') return json({ results: [recallRow()] })
    if (url.pathname === '/drug/drugsfda.json') {
      if (search.includes('submission_class_code')) return json({ meta: { results: { total: 1 } }, results: [approvalRow()] })
      if (search.includes('pembrolizumab')) {
        return json({ results: [approvalRow({ application_number: 'BLA125514', submissions: [{ submission_type: 'ORIG', submission_status: 'AP', submission_status_date: '20140904', submission_class_code: 'TYPE 1' }] })] })
      }
      return answer('', 404) // not in Drugs@FDA: a new biologic
    }
    return answer('', 404)
  }) as typeof fetch
  try {
    const now = new Date(2026, 8, 23)
    const recalls = await recallNews(10, now)
    assert.deepEqual(
      recalls?.map((i) => [i.date, i.tag, i.href]),
      [
        ['2026-09-18', 'Company announcement', '/fda-news/recall/par-health-issues-recall'], // the tejocote supplement and the flour are gone
        ['2026-09-16', 'Class I · Most serious', '/fda-news/recall/D-0850-2026'],
      ],
    )
    const approvals = await approvalNews(10, now)
    assert.deepEqual(
      approvals?.map((i) => [i.date, i.headline]),
      [
        ['2026-09-17', 'FDA Approves First Gene Therapy for Sanfilippo Syndrome'], // not in Drugs@FDA: kept
        ['2026-09-04', 'FDA approves Etcamah (camizestrant) tablets'], // the press release about it is dropped; the pump and Keytruda's new use too
      ],
    )
    assert.equal(approvals?.[0].href, '/fda-news/new-drug/fayuvi')
  } finally {
    global.fetch = originalFetch
  }
})

test('home page: one recall, one new drug and one shortage, and a failing feed is just left out', async () => {
  const originalFetch = global.fetch
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  let drugsfdaDown = false
  const asked: string[] = []
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    asked.push(url)
    if (url.includes('/drug/enforcement.json')) return answer({ results: [recallRow()] })
    if (url.includes('/drug/drugsfda.json')) return drugsfdaDown ? answer({}, 500) : answer({ meta: { results: { total: 1 } }, results: [approvalRow()] })
    if (url.includes('/drug/shortages.json')) return answer({ results: [shortageRow()] })
    return answer({}, 404)
  }) as typeof fetch
  try {
    const now = new Date(2026, 8, 23)
    const items = await fdaHighlights(now)
    assert.deepEqual(items.map((i) => i.kind), ['recall', 'approval', 'shortage'])
    assert.deepEqual(items.map((i) => i.href), ['/fda-news/recall/D-0850-2026', '/fda-news/new-drug/NDA220359', '/fda-news/shortage/pentostatin-injection'])
    drugsfdaDown = true
    assert.deepEqual((await fdaHighlights(now)).map((i) => i.kind), ['recall', 'shortage'])
    // switched off in Admin → Settings: not shown, and the FDA is not even asked
    drugsfdaDown = false
    asked.length = 0
    assert.deepEqual((await fdaHighlights(now, { recall: false, approval: true, shortage: true })).map((i) => i.kind), ['approval', 'shortage'])
    assert.ok(!asked.some((url) => url.includes('/drug/enforcement.json') || url.includes('/recalls/rss.xml')))
  } finally {
    global.fetch = originalFetch
  }
})
