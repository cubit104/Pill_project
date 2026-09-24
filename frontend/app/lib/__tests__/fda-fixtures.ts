/** Trimmed copies of what fda.gov serves, shared by the FDA news tests. */
export const RECALLS_RSS = `<?xml version="1.0" encoding="utf-8"?><rss><channel>
<item><title>Global Mix Inc. Recalls Niwali Tejocote Capsules</title><link>http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/global-mix-inc-recalls-niwali-tejocote-capsules</link><description>Global Mix is recalling …</description><pubDate>Mon, 21 Sep 2026 10:12:00 EDT</pubDate></item>
<item><title>Par Health Issues Voluntary Nationwide Recall of Two Lots of Dexmedetomidine HCl &amp; Saline</title><link>http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/par-health-issues-recall</link><description>Par Health is recalling …</description><pubDate>Fri, 18 Sep 2026 17:48:00 EDT</pubDate></item>
<item><title>GF Blends Recalls Truly AIP All Purpose Flour</title><link>http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/gf-blends-recalls-flour</link><description>GF Blends is recalling …</description><pubDate>Fri, 18 Sep 2026 12:00:00 EDT</pubDate></item>
<item><title>Somewhere else</title><link>https://example.com/not-fda</link><pubDate>Fri, 18 Sep 2026 12:00:00 EDT</pubDate></item>
</channel></rss>`

export const noticePage = (type: string, title: string) => `<html><head><title>${title} | FDA</title>
<meta property="og:title" content="${title}" />
<meta name="description" content="ROCHESTER, MI\uFFFD September 18, 2026 \uFFFDPar Health is voluntarily recalling two lots" />
</head><body><script>var x = "Product Type: Food";</script>
<time datetime="2026-09-18T19:14:00Z">09/18/2026</time>
<dl><dt>Company Announcement Date:</dt><dd><time datetime="2026-09-18T19:14:00Z">September 18, 2026</time></dd>
<dt>FDA Publish Date:</dt><dd>September 21, 2026</dd>
<dt>Product Type:</dt><dd>${type}</dd>
<dt>Reason for Announcement:</dt><dd><p>Recall Reason Description</p><p>Presence of particulate matter identified as cellulose</p></dd>
<dt>Company Name:</dt><dd>Par Health</dd>
<dt>Brand Name:</dt><dd><p>Brand Name(s)</p><p>Par Pharmaceutical</p></dd>
<dt>Product Description:</dt><dd><p>Product Description</p><p>Dexmedetomidine HCl in 0.9% Sodium Chloride Injection 400 mcg/100 mL</p></dd></dl>
<h2>Company Announcement</h2><p>ROCHESTER, MI – Par Health is voluntarily recalling …</p>
<p>Content current as of: 09/21/2026</p><p>Regulated Product(s)</p><ul><li>Drugs</li></ul><p>Follow FDA</p></body></html>`

export const announcementPage = (title: string, summary: string, regulated: string, date = '2026-09-17') => `<html><head>
<meta property="og:title" content="${title}" /><meta name="description" content="${summary}" /></head><body>
<time datetime="${date}T18:30:00Z">${date}</time><p>For Immediate Release: …</p>
<p>Content current as of: 09/17/2026</p><p>Regulated Product(s)</p><ul><li>${regulated}</li></ul><p>Follow FDA</p></body></html>`
