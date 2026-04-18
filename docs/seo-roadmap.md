# PillSeek SEO Roadmap

## Priority 3 — Out of Scope (Document & Follow-Up)

These items were identified as beneficial for long-term SEO but are **out of scope for the initial technical SEO sprint**. They should be addressed in follow-up iterations.

---

### Backlink / Digital PR Strategy

Earning authoritative inbound links is crucial for YMYL sites. Recommended tactics:
- **Outreach to pharmacist bloggers / healthcare educators** to reference PillSeek as a free resource
- **Submit to healthcare resource directories** (e.g., Healthline's resource lists, NLM link programs)
- **Press release / product launch** on healthcare technology news sites when new features launch
- **Guest posts on pharmacy school blogs** and patient advocacy sites
- **Partnerships with harm reduction organizations** who can reference the pill identifier in their resources
- **Sponsor or contribute to open healthcare data projects** to build brand awareness

---

### Medical Reviewer Governance

For YMYL sites, Google explicitly looks for evidence of E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). A lightweight reviewer policy:
- **Assign a licensed pharmacist (PharmD) as a named reviewer** for the editorial process
- Add a **"Medically reviewed by [Name], PharmD"** badge to key pages (About, Medical Disclaimer, hub pages)
- Create a dedicated `/editorial-policy` page describing:
  - Data sources (FDA NDC, DailyMed)
  - Sync frequency / last-updated dates
  - Review process for corrections
  - Named medical reviewer(s) with credentials
- Display **reviewer credentials** prominently — this directly impacts E-E-A-T signals

---

### `/editorial-policy` Page

Create a dedicated editorial policy page covering:
- Data pipeline description (FDA → DailyMed → PillSeek database)
- How frequently data is synced
- How errors are identified and corrected
- Contact method for data corrections
- Named medical reviewer(s)

---

### Pagination & Infinite Scroll SEO

If hub pages grow to > 48 results, implement proper SEO pagination:
- Use clean URL paths: `/color/white/page/2` (not `?page=2`)
- Or use `rel="canonical"` pointing to the first page for paginated results
- Consider cursor-based pagination for performance

---

### Image Search SEO

Pill images are a significant traffic source. Future improvements:
- Add structured `ImageObject` schema with `name`, `caption`, `contentUrl`
- Submit a dedicated image sitemap (`/sitemap-images.xml`)
- Ensure all images are served from a CDN with proper cache headers
- Consider adding watermarks or attribution to protect image assets

---

### Core Web Vitals — Advanced

After implementing basic CWV improvements (done in this sprint), the following advanced optimizations remain:
- **LCP optimization**: Preload the hero pill image on detail pages using `<link rel="preload">`
- **INP (Interaction to Next Paint)**: Audit the search bar for main-thread blocking JavaScript
- **Font optimization**: Self-host Google Fonts to eliminate render-blocking external requests
- **Static asset fingerprinting**: Ensure Next.js build hashes are leveraged for long-cache headers
- **Lighthouse CI**: Add automated Lighthouse CI to the GitHub Actions pipeline to catch regressions

---

### Schema Markup — Advanced

Future schema additions:
- `ImageObject` schema on pill detail pages linking to each pill image
- `HealthTopicContent` (Google Health carousel) if eligibility is met
- `HowTo` schema for the "How to identify a pill" guide
- `SiteLinksSearchBox` (already handled by `WebSite` + `SearchAction`)
- Review `MedicalWebPage` schema eligibility for Google's Medical carousel feature

---

### International SEO (Future)

If expanding beyond English/US:
- Add `hreflang` tags for language variants
- Create country-specific sitemaps
- Consider Canadian brand names (DIN codes) and EU data sources

---

### Voice Search / Featured Snippets

To capture "pill with imprint X" voice queries and featured snippets:
- Ensure `<h1>` text on imprint pages matches common query patterns exactly
- Add concise answer paragraphs immediately below H1 (Google extracts these for snippets)
- Use Q&A format on hub pages to target "PAA" (People Also Ask) boxes

---

## Completed (This Sprint)

- ✅ Per-page `<title>` and `<meta description>` with intent-matching patterns
- ✅ Canonical tags on all pages
- ✅ OG / Twitter cards on all pages
- ✅ Structured data: WebSite, Organization, BreadcrumbList, MedicalWebPage, FAQPage, CollectionPage
- ✅ Trust pages: `/about`, `/contact`, `/privacy`, `/terms`, `/medical-disclaimer`, `/sources`
- ✅ Footer links to all trust pages
- ✅ `robots.txt` updated (disallow `/api/`, `/admin/`, search query params)
- ✅ `sitemap.xml` updated (all static pages + pill pages)
- ✅ Hub pages: `/color/[color]`, `/shape/[shape]`, `/drug/[name]`, `/imprint/[imprint]`
- ✅ Internal linking: breadcrumbs on all non-home pages, related pills links on detail pages
- ✅ Image `alt` text made descriptive on pill detail and card pages
- ✅ `loading="lazy"` on below-fold images, `width`/`height` set to reduce CLS
- ✅ `noindex,follow` on search result pages (`/search`)
- ✅ `noindex,follow` on thin pill pages (missing imprint/NDC)
