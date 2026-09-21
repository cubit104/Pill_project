'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import IvDrugBody from '../../../../(public)/iv/[slug]/IvDrugBody'
import type { IvDrug } from '../../../../lib/iv'
import { createClient } from '../../../lib/supabase'
import { adminApi } from '../../../lib/api'
import type { CardStatus } from '../../status'

type PreviewDrug = IvDrug & { card_status: CardStatus; published: boolean }

/**
 * The IV drug page as visitors will see it, for staff: works for a hidden drug and shows a card nobody approved yet.
 * It renders the same component as the public page; only the data comes from the admin API (login required).
 */
export default function AdminIvPreviewPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [drug, setDrug] = useState<PreviewDrug | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await createClient().auth.getSession()
      if (!session) {
        router.push('/admin/login')
        return
      }
      try {
        setDrug((await adminApi.previewIvDrug(id)) as PreviewDrug)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load the preview')
      }
    })()
  }, [id, router])

  if (!drug) return <div className="p-6 text-slate-600">{error || 'Loading…'}</div>

  const cardIsPublic = drug.card_status === 'approved'
  return (
    <div className="bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={`/admin/iv/${id}`} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to review
          </Link>
          <span>
            <b>Preview, staff only.</b> {drug.published ? 'This drug is published.' : 'This drug is hidden from the site.'}{' '}
            {drug.card
              ? cardIsPublic
                ? 'The card is approved.'
                : `The card ${drug.card_status === 'rejected' ? 'was REJECTED' : 'is a DRAFT'}: visitors do not see it until it is approved.`
              : 'No card yet.'}
          </span>
          <span className="text-amber-800/80">The live page adds the shortage banner, recalls and the reviewer line. Tab links work once the drug is published.</span>
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <IvDrugBody drug={drug} />
      </div>
    </div>
  )
}
