'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'

export interface DrugDetails {
  generic_name: string
  brand_names: string[]
  drug_class: string[]
  slug: string
  published: boolean
  meta_title: string | null
  meta_description: string | null
  suggested_meta_title: string
  suggested_meta_description: string
}

const TITLE_GOOD = 65
const DESCRIPTION_GOOD = 160

function Counter({ length, good }: { length: number; good: number }) {
  return <span className={`text-xs ${length > good ? 'text-amber-700' : 'text-slate-400'}`}>{length} / {good}</span>
}

/**
 * Name, brands, class, page address and SEO text of one IV drug. The meta fields work like the pill ones:
 * left empty, the page uses the automatic text shown as the suggestion; typed text always wins.
 */
export default function DetailsForm({ drug, busy, onSave }: { drug: DrugDetails; busy: boolean; onSave: (changes: object) => void }) {
  const [name, setName] = useState(drug.generic_name)
  const [brands, setBrands] = useState(drug.brand_names.join(', '))
  const [classes, setClasses] = useState(drug.drug_class.join('; '))
  const [slug, setSlug] = useState(drug.slug)
  const [metaTitle, setMetaTitle] = useState(drug.meta_title ?? '')
  const [metaDescription, setMetaDescription] = useState(drug.meta_description ?? '')

  useEffect(() => {
    setName(drug.generic_name)
    setBrands(drug.brand_names.join(', '))
    setClasses(drug.drug_class.join('; '))
    setSlug(drug.slug)
    setMetaTitle(drug.meta_title ?? '')
    setMetaDescription(drug.meta_description ?? '')
  }, [drug])

  const split = (value: string, by: RegExp) => value.split(by).map((part) => part.trim()).filter(Boolean)
  const changes: Record<string, unknown> = {}
  if (name.trim() !== drug.generic_name) changes.generic_name = name.trim()
  if (split(brands, /,/).join('|') !== drug.brand_names.join('|')) changes.brand_names = split(brands, /,/)
  if (split(classes, /;/).join('|') !== drug.drug_class.join('|')) changes.drug_class = split(classes, /;/)
  if (slug.trim() !== drug.slug) changes.slug = slug.trim()
  if (metaTitle.trim() !== (drug.meta_title ?? '')) changes.meta_title = metaTitle.trim()
  if (metaDescription.trim() !== (drug.meta_description ?? '')) changes.meta_description = metaDescription.trim()
  const dirty = Object.keys(changes).length > 0

  const input = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500'

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-800">Details and SEO</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Drug name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Page address</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={drug.published} maxLength={200} className={`${input} font-mono`} />
          <span className="mt-1 block text-xs text-slate-500">
            pillseek.com/iv/{slug || '…'} {drug.published && '· fixed while the page is published'}
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Brand names (comma separated)</span>
          <input value={brands} onChange={(e) => setBrands(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Drug class (semicolon separated)</span>
          <input value={classes} onChange={(e) => setClasses(e.target.value)} className={input} />
        </label>
      </div>

      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
          Meta title <Counter length={(metaTitle || drug.suggested_meta_title).length} good={TITLE_GOOD} />
        </span>
        <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={120} placeholder={drug.suggested_meta_title} className={input} />
      </label>
      <label className="block">
        <span className="flex items-baseline justify-between text-xs font-semibold text-slate-600">
          Meta description <Counter length={(metaDescription || drug.suggested_meta_description).length} good={DESCRIPTION_GOOD} />
        </span>
        <textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} maxLength={320} rows={2} placeholder={drug.suggested_meta_description} className={input} />
        <span className="mt-1 block text-xs text-slate-500">Leave a meta field empty to use the automatic text shown in grey.</span>
      </label>

      <button
        disabled={!dirty || busy}
        onClick={() => onSave(changes)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        <Save className="h-4 w-4" /> Save details
      </button>
    </section>
  )
}
