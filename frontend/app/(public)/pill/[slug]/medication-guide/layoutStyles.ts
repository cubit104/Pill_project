export const SHARED_CONTENT_GRID_CLASSES =
  'space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[15rem_minmax(0,60rem)] lg:gap-8 lg:items-start lg:justify-center'
export const SHARED_CONTENT_ASIDE_CLASSES =
  'no-print hidden lg:block lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto w-full lg:w-60'
export const SHARED_CONTENT_CARD_CLASSES =
  'min-w-0 w-full bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6'
export const PRO_HIGHLIGHTS_CONTAINER_CLASSES =
  'rounded-xl border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/40 p-5'
export const PRO_HIGHLIGHTS_PROSE_CLASSES = [
  // Highlights wrapper structure
  '[&_.pro-highlights-header]:flex [&_.pro-highlights-header]:flex-wrap [&_.pro-highlights-header]:items-baseline [&_.pro-highlights-header]:gap-x-2 [&_.pro-highlights-header]:mb-3',
  '[&_.pro-highlights-title]:text-sm [&_.pro-highlights-title]:font-bold [&_.pro-highlights-title]:text-slate-900 [&_.pro-highlights-title]:uppercase [&_.pro-highlights-title]:tracking-wide',
  '[&_.pro-highlights-meta]:text-xs [&_.pro-highlights-meta]:text-slate-500 [&_.pro-highlights-meta]:italic',
  '[&_.pro-highlights-body]:text-sm [&_.pro-highlights-body]:text-slate-800',
  // Sub-section blocks — dashed border dividers like DailyMed
  '[&_.pro-highlights-section]:border-t [&_.pro-highlights-section]:border-dashed [&_.pro-highlights-section]:border-slate-300 [&_.pro-highlights-section]:pt-3 [&_.pro-highlights-section]:mt-3',
  // Sub-section headings
  '[&_.pro-highlights-section-title]:text-xs [&_.pro-highlights-section-title]:font-bold [&_.pro-highlights-section-title]:uppercase [&_.pro-highlights-section-title]:tracking-widest [&_.pro-highlights-section-title]:text-slate-700 [&_.pro-highlights-section-title]:mb-2 [&_.pro-highlights-section-title]:mt-0 [&_.pro-highlights-section-title]:text-center',
  // Plain h3 fallback
  '[&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-widest [&_h3]:text-slate-700 [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-center',
  // h2
  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:mb-2 [&_h2]:mt-3',
  // Body text
  '[&_p]:text-sm [&_p]:text-slate-800 [&_p]:leading-7 [&_p]:my-1',
  // Bullet lists
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-7 [&_li]:text-slate-800',
  // Section reference links
  '[&_a.pro-section-ref]:text-sky-700 [&_a.pro-section-ref:hover]:underline',
  '[&_a]:text-sky-700 [&_a:hover]:underline',
  // Strong/em
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
].join(' ')
export const PRO_BOXED_WARNING_PROSE_CLASSES = [
  '[&_.pro-boxed-warning-callout]:my-8 [&_.pro-boxed-warning-callout]:rounded-xl [&_.pro-boxed-warning-callout]:border [&_.pro-boxed-warning-callout]:border-rose-300 [&_.pro-boxed-warning-callout]:border-l-4 [&_.pro-boxed-warning-callout]:border-l-rose-600 [&_.pro-boxed-warning-callout]:bg-rose-50 [&_.pro-boxed-warning-callout]:p-5',
  '[&_.pro-boxed-warning-callout_h2]:mt-0 [&_.pro-boxed-warning-callout_h2]:mb-3 [&_.pro-boxed-warning-callout_h2]:text-base [&_.pro-boxed-warning-callout_h2]:font-semibold [&_.pro-boxed-warning-callout_h2]:text-rose-900',
  '[&_.pro-boxed-warning-callout_h3]:mt-5 [&_.pro-boxed-warning-callout_h3]:mb-3 [&_.pro-boxed-warning-callout_h3]:text-sm [&_.pro-boxed-warning-callout_h3]:font-semibold [&_.pro-boxed-warning-callout_h3]:text-rose-900',
  '[&_.pro-boxed-warning-callout_p]:my-3 [&_.pro-boxed-warning-callout_p]:text-rose-950 [&_.pro-boxed-warning-callout_p]:leading-8',
  '[&_.pro-boxed-warning-callout_ul]:my-3 [&_.pro-boxed-warning-callout_ul]:space-y-2 [&_.pro-boxed-warning-callout_ul]:text-rose-950',
  '[&_.pro-boxed-warning-callout_ol]:my-3 [&_.pro-boxed-warning-callout_ol]:space-y-2 [&_.pro-boxed-warning-callout_ol]:text-rose-950',
  '[&_.pro-boxed-warning-callout_li]:my-2 [&_.pro-boxed-warning-callout_li]:text-rose-950 [&_.pro-boxed-warning-callout_li]:leading-8',
  '[&_.pro-boxed-warning-callout_a]:text-rose-800 [&_.pro-boxed-warning-callout_a:hover]:text-rose-950',
  '[&_.pro-boxed-warning-callout_strong]:text-rose-950',
].join(' ')
