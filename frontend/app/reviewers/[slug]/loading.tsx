export default function ReviewerProfileLoading() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 shadow-sm h-12" />

      <main className="max-w-4xl mx-auto px-4 py-10 space-y-8 animate-pulse">
        {/* Hero skeleton */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="h-24 bg-slate-200" />
          <div className="px-6 pb-8">
            <div className="-mt-14 mb-4">
              <div className="w-28 h-28 rounded-full bg-slate-300 ring-4 ring-white" />
            </div>
            <div className="h-8 w-64 bg-slate-200 rounded-lg mb-3" />
            <div className="h-5 w-32 bg-slate-100 rounded-full" />
          </div>
        </div>

        {/* Bio skeleton */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7 space-y-3">
          <div className="h-6 w-24 bg-slate-200 rounded-lg" />
          <div className="h-4 w-full bg-slate-100 rounded" />
          <div className="h-4 w-5/6 bg-slate-100 rounded" />
          <div className="h-4 w-4/6 bg-slate-100 rounded" />
        </div>

        {/* Education skeleton */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-7 space-y-3">
          <div className="h-6 w-28 bg-slate-200 rounded-lg" />
          <div className="h-4 w-3/4 bg-slate-100 rounded" />
          <div className="h-4 w-2/4 bg-slate-100 rounded" />
        </div>
      </main>
    </div>
  )
}
