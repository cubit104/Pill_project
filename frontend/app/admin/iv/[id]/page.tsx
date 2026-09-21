'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Check, ExternalLink, Eye, RefreshCw, Save, Sparkles, X } from 'lucide-react'
import { createClient } from '../../lib/supabase'
import { adminApi } from '../../lib/api'
import { useUserRole } from '../../lib/useUserRole'
import { STATUS_LABEL, STATUS_STYLE, type CardStatus } from '../status'
import DetailsForm from './DetailsForm'
import LabelTools from './LabelTools'

type FieldStatus = 'stated' | 'not_stated' | 'not_applicable'

interface CardField {
  status: FieldStatus
  value: string
  quotes: Array<{ section: string; text: string }>
}

interface IvDrugDetail {
  id: string
  slug: string
  generic_name: string
  brand_names: string[]
  drug_class: string[]
  label_type: string | null
  label_brand: string | null
  label_maker: string | null
  label_presentation: string | null
  label_version: number | null
  label_date: string | null
  spl_set_id: string
  other_setids: string[]
  setid_locked: boolean
  maker_count: number
  product_count: number
  published: boolean
  card_status: CardStatus
  card: {
    fields?: Record<string, CardField>
    notes_for_reviewer?: string
    rejected_by_check?: string[]
    quotes_checked?: number
    source?: string
  } | null
  card_label_version: number | null
  card_reviewed_by: string | null
  card_reviewed_at: string | null
  card_review_notes: string | null
  label_updated_since: boolean
  card_questions: Record<string, string>
  card_labels: Record<string, string>
  ai_available: boolean
  meta_title: string | null
  meta_description: string | null
  suggested_meta_title: string
  suggested_meta_description: string
}

const EMPTY: CardField = { status: 'not_stated', value: '', quotes: [] }
const dailyMed = (setid: string) => `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pillseek.com').replace(/\/$/, '')

function title(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export default function AdminIvDrugPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const { role } = useUserRole()
  const canEdit = role === 'superuser' || role === 'editor'

  const [drug, setDrug] = useState<IvDrugDetail | null>(null)
  const [fields, setFields] = useState<Record<string, CardField>>({})
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [rejectNotes, setRejectNotes] = useState('')
  const [otherSetid, setOtherSetid] = useState('')
  // set by the publish that just happened, the way the pill screen does it
  const [justPublished, setJustPublished] = useState(false)
  const [indexNowQueued, setIndexNowQueued] = useState(false)

  const show = useCallback((next: IvDrugDetail) => {
    setDrug((previous) => ({ ...(previous ?? {}), ...next }) as IvDrugDetail)
    setFields(next.card?.fields ?? {})
    setNotes(next.card?.notes_for_reviewer ?? '')
    setDirty(false)
  }, [])

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await createClient().auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }
      try {
        show((await adminApi.getIvDrug(id)) as IvDrugDetail)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load this drug')
      }
    })()
  }, [id, router, show])

  const run = async (name: string, action: () => Promise<unknown>, done: string) => {
    setBusy(name)
    setError('')
    setMessage('')
    setJustPublished(false)
    setIndexNowQueued(false)
    try {
      const result = (await action()) as IvDrugDetail & { indexnow_queued?: boolean }
      show(result)
      setMessage(done)
      setJustPublished(name === 'publish' && result.published)
      setIndexNowQueued(name === 'publish' && result.indexnow_queued === true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      // an approval the quote check refused still saved a cleaned draft: show it
      if (name === 'approve') adminApi.getIvDrug(id).then((d) => show(d as IvDrugDetail)).catch(() => {})
    } finally {
      setBusy('')
    }
  }

  const edit = (key: string, patch: Partial<CardField>) => {
    setFields((current) => ({ ...current, [key]: { ...(current[key] ?? EMPTY), ...patch } }))
    setDirty(true)
  }

  if (!drug) {
    return <div className="p-6 text-slate-600">{error || 'Loading…'}</div>
  }

  const hasCard = Boolean(drug.card?.fields)
  const thrownOut = drug.card?.rejected_by_check ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/admin/iv" className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> IV drugs
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{drug.generic_name}</h1>
          <p className="text-sm text-slate-600">
            {[drug.brand_names.join(', '), drug.drug_class.join('; ')].filter(Boolean).join(' · ') || 'No brand names'} · {drug.product_count} products,{' '}
            {drug.maker_count} makers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/iv/${drug.id}/preview`}
            title="The drug page as visitors will see it, draft card included. Staff only."
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-4 w-4" /> Preview page
          </Link>
          {drug.published && (
            <a
              href={`${SITE_URL}/iv/${drug.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" /> View Live Page
            </a>
          )}
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLE[drug.card_status]}`}>{STATUS_LABEL[drug.card_status]}</span>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${drug.published ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
            {drug.published ? 'Published' : 'Hidden from site'}
          </span>
        </div>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {message && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>{message}{justPublished ? ' The site shows it within about 5 minutes.' : ''}</span>
          {justPublished && (
            <a href={`${SITE_URL}/iv/${drug.slug}`} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold underline hover:text-emerald-900">
              View Live Page →
            </a>
          )}
        </p>
      )}
      {indexNowQueued && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          IndexNow: page queued for submission to Bing &amp; Yandex for faster indexing.
        </p>
      )}

      {/* The label the card is built from */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">FDA label used for this drug</h2>
        <p className="text-sm text-slate-700">
          <b>{drug.label_brand || 'Label'}</b>
          {[drug.label_maker, drug.label_type, drug.label_presentation].filter(Boolean).map((part) => ` · ${part}`)}
          {drug.label_version ? ` · version ${drug.label_version}` : ''}
          {drug.label_date ? ` · ${drug.label_date}` : ''}
          {drug.setid_locked ? ' · picked by hand' : ''}
        </p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <a href={dailyMed(drug.spl_set_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
            Open this label on DailyMed <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </p>
        {drug.label_updated_since && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            FDA published a newer version of this label after the card was made (card: version {drug.card_label_version}, now: {drug.label_version}).
            Draft the card again or re-check it before approving.
          </p>
        )}
        {canEdit && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-600 hover:text-slate-800">Wrong label? Use another one{drug.other_setids.length > 0 ? ` (${drug.other_setids.length} alternatives)` : ''}</summary>
            <p className="mt-2 text-xs text-slate-500">Open a label to check it first. Switching clears the current card, because a card belongs to the label it was made from.</p>
            <ul className="mt-2 space-y-1.5">
              {drug.other_setids.map((setid) => (
                <li key={setid} className="flex flex-wrap items-center gap-3">
                  <a href={dailyMed(setid)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-sky-700 hover:underline">{setid}</a>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (window.confirm('Use this label instead? The current card will be cleared.')) {
                        void run('label', () => adminApi.switchIvLabel(drug.id, setid), 'Label switched. Draft a new card from it.')
                      }
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Use this label
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={otherSetid}
                onChange={(e) => setOtherSetid(e.target.value)}
                placeholder="…or paste any DailyMed Set ID"
                className="min-w-72 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
              />
              <button
                disabled={Boolean(busy) || !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(otherSetid)}
                onClick={() => {
                  const setid = otherSetid.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? ''
                  if (window.confirm('Use this label instead? The current card will be cleared. The label must be an injection label.')) {
                    void run('label', () => adminApi.switchIvLabel(drug.id, setid), 'Label switched. Draft a new card from it.')
                    setOtherSetid('')
                  }
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Check and use
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              The label is checked first: it must have an intravenous product, so the label of the tablets or capsules cannot be attached here.
            </p>
          </details>
        )}
        <LabelTools drugId={drug.id} splSetId={drug.spl_set_id} canEdit={canEdit} />
      </section>

      {canEdit && (
        <DetailsForm
          drug={drug}
          busy={Boolean(busy)}
          onSave={(changes) => void run('details', () => adminApi.editIvDetails(drug.id, changes), 'Details saved.')}
        />
      )}

      {/* Actions */}
      <section className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            disabled={Boolean(busy) || !drug.ai_available || drug.card_status === 'approved'}
            title={!drug.ai_available ? 'No GEMINI_API_KEY on this server' : drug.card_status === 'approved' ? 'Reject the approved card first' : ''}
            onClick={() => {
              if (!hasCard || window.confirm('Draft a new card? The current draft will be replaced.')) {
                void run('generate', () => adminApi.generateIvCard(drug.id), 'New draft ready. Every quote was checked against the label.')
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {busy === 'generate' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy === 'generate' ? 'Drafting (about a minute)…' : hasCard ? 'Draft again with AI' : 'Draft card with AI'}
          </button>
        )}
        {hasCard && (
          <>
            <button
              disabled={Boolean(busy) || !dirty}
              onClick={() => void run('save', () => adminApi.saveIvCard(drug.id, { fields, notes_for_reviewer: notes }), 'Saved as draft. Quotes re-checked.')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Save className="h-4 w-4" /> Save edits
            </button>
            <button
              disabled={Boolean(busy) || dirty || drug.card_status === 'approved'}
              title={dirty ? 'Save your edits first' : ''}
              onClick={() => void run('approve', () => adminApi.approveIvCard(drug.id), 'Approved. The card is now shown on the drug page.')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <Check className="h-4 w-4" /> Approve card
            </button>
          </>
        )}
        {canEdit && (
          <button
            disabled={Boolean(busy)}
            onClick={() => void run('publish', () => adminApi.setIvPublished(drug.id, !drug.published), drug.published ? 'Hidden from the site.' : 'Published on the site.')}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {drug.published ? 'Hide from site' : 'Publish drug page'}
          </button>
        )}
      </section>

      {!hasCard && (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No card yet. {drug.ai_available ? 'Draft one with AI, then review it here.' : 'Cards are drafted on the live admin, where the AI key is set.'} The drug page
          can be published without a card; it then shows the strengths and the FDA label only.
        </p>
      )}

      {hasCard && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">IV glance card</h2>
            <p className="text-xs text-slate-500 mt-1">
              Six short answers a nurse reads in seconds; the site hides the ones that say &quot;Not stated&quot;. Check each answer against its quotes. You may reword an answer or clear it; you cannot add a fact without a quote from the label.{' '}
              {drug.card?.quotes_checked ? `${drug.card.quotes_checked} quotes were checked by machine. ` : ''}
              {drug.card?.source ? `Drafted by ${drug.card.source}.` : ''}
            </p>
          </div>

          {thrownOut.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              The quote check threw out {thrownOut.length === 1 ? 'one answer' : `${thrownOut.length} answers`} whose quote was not in the label:{' '}
              {thrownOut.map((key) => drug.card_labels?.[key] ?? title(key)).join(', ')}. They now read &quot;Not stated&quot;.
            </p>
          )}
          {notes && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"><b>Note from the draft:</b> {notes}</p>
          )}

          <div className="space-y-3">
            {Object.entries(drug.card_questions).map(([key, question]) => {
              const field = fields[key] ?? EMPTY
              const stated = field.status !== 'not_stated'
              return (
                <div key={key} className={`rounded-lg border p-3 ${stated ? 'border-slate-200' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">{drug.card_labels?.[key] ?? title(key)}</h3>
                    <span className="text-xs text-slate-500">{question}</span>
                  </div>
                  {stated ? (
                    <>
                      <textarea
                        value={field.value}
                        maxLength={170}
                        rows={2}
                        onChange={(e) => edit(key, { value: e.target.value })}
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                      <p className={`mt-1 text-xs ${field.value.length > 90 ? 'text-amber-700' : 'text-slate-400'}`}>
                        {field.value.length} characters{field.value.length > 90 ? ': long for a glance card, shorten if you can' : ''}
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-sky-700 hover:text-sky-900">
                          {field.quotes.length === 1 ? '1 quote' : `${field.quotes.length} quotes`} from the label (each found word for word)
                        </summary>
                        {field.quotes.map((quote, i) => (
                          <blockquote key={i} className="mt-2 rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-slate-700">
                            {quote.text}
                            <span className="mt-1 block text-xs text-slate-500">{quote.section}</span>
                          </blockquote>
                        ))}
                      </details>
                      <button
                        onClick={() => edit(key, { status: 'not_stated', value: '', quotes: [] })}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-rose-700 hover:underline"
                      >
                        <X className="h-3.5 w-3.5" /> Remove this answer (show &quot;Not stated in the FDA label&quot;)
                      </button>
                    </>
                  ) : (
                    <p className="mt-1 text-sm italic text-slate-400">Not stated in the FDA label</p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reject this card (it stays hidden; say why)</label>
            <div className="flex flex-wrap gap-2">
              <input
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                maxLength={1000}
                placeholder="e.g. wrong label: this one is a premixed bag"
                className="min-w-64 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                disabled={Boolean(busy)}
                onClick={() => void run('reject', () => adminApi.rejectIvCard(drug.id, rejectNotes), 'Card rejected.')}
                className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
            {drug.card_review_notes && <p className="mt-2 text-xs text-slate-500">Last rejection note: {drug.card_review_notes}</p>}
            {drug.card_reviewed_by && (
              <p className="mt-2 text-xs text-slate-500">
                {drug.card_status === 'approved' ? 'Approved' : 'Last decision'} by {drug.card_reviewed_by}
                {drug.card_reviewed_at ? ` on ${new Date(drug.card_reviewed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
