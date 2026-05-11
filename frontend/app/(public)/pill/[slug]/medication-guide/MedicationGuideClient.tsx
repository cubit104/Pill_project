'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { slugifyDrugName } from '../../../../lib/slug'
import { linkifyText } from '../../../../lib/linkifyText'

type TabId = 'medication' | 'professional'

interface Props {
  slug: string
  drugName: string
  medicationGuideContent: string
  professionalContent: string
  sourceUrl?: string
  poisonHelpText?: string
  lastUpdatedIso?: string
  formattedDate?: string
  conditionTags?: string[]
  mentionedDrugNames?: string[]
}

type ContentBlock = {
  type: 'h1' | 'h2' | 'h3' | 'p'
  text: string
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTextBlocks(raw: string): ContentBlock[] {
  if (!raw) return []
  const blocks: ContentBlock[] = []

  if (typeof window !== 'undefined' && raw.includes('<')) {
    const parser = new window.DOMParser()
    const doc = parser.parseFromString(raw, 'text/html')
    const nodes = Array.from(doc.body.children)

    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase()
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text) return

      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        blocks.push({ type: tag, text })
        return
      }
      if (tag === 'p' || tag === 'li') {
        blocks.push({ type: 'p', text })
        return
      }
      if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(node.querySelectorAll(':scope > li'))) {
          const liText = (li.textContent || '').replace(/\s+/g, ' ').trim()
          if (liText) blocks.push({ type: 'p', text: liText })
        }
        return
      }
      for (const child of Array.from(node.children)) {
        walk(child)
      }
    }

    for (const node of nodes) {
      walk(node)
    }
  }

  if (blocks.length > 0) return blocks

  const plain = raw.includes('<') ? stripTags(raw) : raw
  const sections = plain.split(/\n\s*\n+/).map((line) => line.trim()).filter(Boolean)
  return sections.map((text) => ({ type: 'p', text }))
}

function ContentRenderer(
  {
    content,
    drugName,
    conditionTags,
    mentionedDrugNames,
  }: {
    content: string
    drugName: string
    conditionTags: string[]
    mentionedDrugNames: string[]
  },
) {
  const blocks = useMemo(() => parseTextBlocks(content), [content])

  if (blocks.length === 0) {
    return <p className="text-sm text-slate-700 leading-relaxed">No content available for this tab yet.</p>
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => {
        if (block.type === 'h1') {
          return (
            <h1 key={`${block.type}-${idx}`} className="text-2xl font-bold text-slate-900">
              {linkifyText(block.text, drugName, conditionTags, mentionedDrugNames)}
            </h1>
          )
        }
        if (block.type === 'h2') {
          return (
            <h2 key={`${block.type}-${idx}`} className="text-lg font-semibold text-slate-800">
              {linkifyText(block.text, drugName, conditionTags, mentionedDrugNames)}
            </h2>
          )
        }
        if (block.type === 'h3') {
          return (
            <h3 key={`${block.type}-${idx}`} className="text-base font-medium text-slate-800">
              {linkifyText(block.text, drugName, conditionTags, mentionedDrugNames)}
            </h3>
          )
        }
        return (
          <p key={`${block.type}-${idx}`} className="text-sm text-slate-700 leading-relaxed">
            {linkifyText(block.text, drugName, conditionTags, mentionedDrugNames)}
          </p>
        )
      })}
    </div>
  )
}

export default function MedicationGuideClient({
  slug,
  drugName,
  medicationGuideContent,
  professionalContent,
  sourceUrl,
  poisonHelpText,
  lastUpdatedIso,
  formattedDate,
  conditionTags = [],
  mentionedDrugNames = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('medication')
  const drugSlug = slugifyDrugName(drugName)
  const tabContent = activeTab === 'medication' ? medicationGuideContent : professionalContent
  const fallbackSourceUrl = sourceUrl || (slug ? `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(slug)}` : '')
  const warningText = poisonHelpText ? stripTags(poisonHelpText) : 'In case of overdose, call Poison Help at 1-800-222-1222 right away.'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1 text-sm text-slate-500 flex-wrap">
          <li>
            <Link href="/" className="hover:text-sky-700 transition-colors">
              Home
            </Link>
          </li>
          {drugSlug && (
            <>
              <li aria-hidden="true" className="select-none">›</li>
              <li>
                <Link href={`/drug/${drugSlug}`} className="hover:text-sky-700 transition-colors">
                  {drugName}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true" className="select-none">›</li>
          <li aria-current="page" className="text-slate-700 font-medium">Medication Guide</li>
        </ol>
      </nav>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
        <div role="tablist" aria-label="Medication content tabs" className="flex items-end gap-4 border-b border-slate-200 mb-4">
          <button
            role="tab"
            id="medication-tab"
            aria-selected={activeTab === 'medication'}
            aria-controls="medication-panel"
            onClick={() => setActiveTab('medication')}
            className={`pb-2 text-sm font-medium transition-colors ${
              activeTab === 'medication'
                ? 'text-emerald-700 border-b-2 border-emerald-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Medication Guide
          </button>
          <button
            role="tab"
            id="professional-tab"
            aria-selected={activeTab === 'professional'}
            aria-controls="professional-panel"
            onClick={() => setActiveTab('professional')}
            className={`pb-2 text-sm font-medium transition-colors ${
              activeTab === 'professional'
                ? 'text-emerald-700 border-b-2 border-emerald-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Full Prescribing Information
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {formattedDate && lastUpdatedIso && (
            <span>
              Last updated <time dateTime={lastUpdatedIso}>{formattedDate}</time>
            </span>
          )}
          <span>·</span>
          {fallbackSourceUrl ? (
            <a
              href={fallbackSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline"
            >
              Source: DailyMed ↗
            </a>
          ) : (
            <span>Source: DailyMed</span>
          )}
          <span>·</span>
          <button
            type="button"
            onClick={() => window.print()}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            Print
          </button>
        </div>
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6 text-amber-800">
        <h2 className="text-base font-semibold text-amber-800 mb-2">Poison Help / Safety</h2>
        <p className="text-sm leading-relaxed">{warningText}</p>
      </section>

      <section
        id={activeTab === 'medication' ? 'medication-panel' : 'professional-panel'}
        role="tabpanel"
        aria-labelledby={activeTab === 'medication' ? 'medication-tab' : 'professional-tab'}
        className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6"
      >
        <ContentRenderer
          content={tabContent}
          drugName={drugName}
          conditionTags={conditionTags}
          mentionedDrugNames={mentionedDrugNames}
        />
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <h2 className="text-base font-semibold text-amber-800 mb-2">⚠️ Disclaimer</h2>
        <p className="text-sm text-amber-800 leading-relaxed">
          This medication guide is for educational purposes only and is not a substitute for professional
          medical advice. Always consult your pharmacist or prescriber for questions about your treatment.{' '}
          <Link href="/medical-disclaimer" className="underline hover:text-amber-900">
            Read full medical disclaimer
          </Link>
          .
        </p>
      </section>
    </div>
  )
}

