export type CardStatus = 'none' | 'draft' | 'approved' | 'rejected'

export const STATUS_STYLE: Record<CardStatus, string> = {
  none: 'bg-slate-100 text-slate-600 border-slate-200',
  draft: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
}

export const STATUS_LABEL: Record<CardStatus, string> = {
  none: 'No card',
  draft: 'Draft: needs review',
  approved: 'Approved',
  rejected: 'Rejected',
}
