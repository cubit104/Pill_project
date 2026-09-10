import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card, { SectionLabel } from '../components/Card'
import ErrorCard from '../components/ErrorCard'
import { ChevronRightIcon, ExternalIcon, ShieldIcon } from '../components/Icons'
import { TextBadge } from '../components/PillRow'
import { Skeleton } from '../components/Skeleton'
import { ApiError, getEditorialTeam, type TeamMember } from '../lib/api'
import { useBackHandler } from '../lib/backstack'
import { useT } from '../lib/i18n'
import { hapticTick, openUrl } from '../lib/native'

/** English labels; translated at the render site. */
const ROLE_LABEL: Record<string, string> = {
  medical_reviewer: 'Medical reviewer',
  author: 'Author',
  editor: 'Editor',
}

function roleLabel(role: string | null): string | null {
  if (!role) return null
  return ROLE_LABEL[role.toLowerCase()] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function Avatar({ member, size }: { member: TeamMember; size: number }) {
  const [failed, setFailed] = useState(false)
  if (member.avatar_url && !failed) {
    return (
      <img
        src={member.avatar_url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span className="flex flex-none items-center justify-center rounded-full bg-brand-tint font-bold text-brand" style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden>
      {initials(member.name)}
    </span>
  )
}

function LinkRow({ title, subtitle, url }: { title: string; subtitle?: string | null; url?: string | null }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-ink">{title}</span>
        {subtitle && <span className="block text-[13px] text-muted">{subtitle}</span>}
      </span>
      {url && <ExternalIcon size={16} className="flex-none text-muted" />}
    </>
  )
  if (!url) return <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
  return (
    <button type="button" onClick={() => void openUrl(url)} className="pressable flex w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-tint">
      {inner}
    </button>
  )
}

function Profile({ member }: { member: TeamMember }) {
  const t = useT()
  const role = roleLabel(member.role)
  return (
    <>
      <Card className="flex flex-col items-center py-6 text-center">
        <Avatar member={member} size={96} />
        <h1 className="mt-4 text-[24px] font-bold tracking-tight text-ink">
          {member.name}
          {member.credentials && <span className="font-medium text-muted">, {member.credentials}</span>}
        </h1>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {role && <TextBadge tone="brand">{t(role)}</TextBadge>}
          {member.specialty && <TextBadge tone="neutral">{member.specialty}</TextBadge>}
        </div>
        {member.license_info && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted">
            <ShieldIcon size={14} /> {member.license_info}
          </p>
        )}
      </Card>

      {member.bio && (
        <section>
          <SectionLabel>{t('About')}</SectionLabel>
          <Card>
            <p className="selectable whitespace-pre-line text-[15px] leading-relaxed text-body">{member.bio}</p>
          </Card>
        </section>
      )}

      {member.education.length > 0 && (
        <section>
          <SectionLabel>{t('Education')}</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {member.education.map((e, i) => (
              <LinkRow key={i} title={e.degree ?? e.institution ?? t('Education')} subtitle={e.degree ? e.institution : null} url={e.url} />
            ))}
          </Card>
        </section>
      )}

      {member.registrations.length > 0 && (
        <section>
          <SectionLabel>{t('Registrations')}</SectionLabel>
          <Card padded={false} className="divide-y divide-line overflow-hidden">
            {member.registrations.map((r, i) => (
              <LinkRow key={i} title={r.title ?? r.board ?? t('Registration')} subtitle={r.title ? r.board : null} url={r.url} />
            ))}
          </Card>
        </section>
      )}

      {member.linkedin_url && (
        <Card padded={false} className="overflow-hidden">
          <LinkRow title={t('LinkedIn profile')} url={member.linkedin_url} />
        </Card>
      )}
    </>
  )
}

/**
 * Editorial team: who reviews PillSeek content. /editorial-team lists members,
 * /editorial-team/:slug shows one profile (the "Reviewed by" byline lands here).
 */
export default function EditorialScreen({ slug }: { slug: string | null }) {
  const t = useT()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [team, setTeam] = useState<TeamMember[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/home', { replace: true }))
  useBackHandler(true, goBack)

  useEffect(() => {
    const ctrl = new AbortController()
    setError(null)
    getEditorialTeam(ctrl.signal)
      .then((t) => !ctrl.signal.aborted && setTeam(t))
      .catch((err: unknown) => !ctrl.signal.aborted && setError(err instanceof ApiError ? err : new ApiError('unknown', t('Could not load the editorial team.'))))
    return () => ctrl.abort()
  }, [reloadKey, t])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [slug])

  const member = slug && team ? team.find((m) => m.slug === slug) ?? null : null
  const showProfile = slug !== null
  const title = showProfile ? member?.name ?? t('Reviewer') : t('Editorial team')
  /** Role labels are English constants; the API's own role names fall through untranslated. */
  const roleText = (role: string | null): string | null => {
    const label = roleLabel(role)
    return label ? t(label) : null
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas animate-fade-up">
      <div
        className="sticky top-0 z-20 flex items-center gap-2 bg-[color-mix(in_srgb,var(--canvas)_95%,transparent)] px-2 pb-2 backdrop-blur"
        style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingLeft: 'max(8px, var(--safe-left))', paddingRight: 'max(8px, var(--safe-right))' }}
      >
        <button type="button" onClick={goBack} aria-label={t('Back')} className="pressable flex h-11 min-w-[44px] items-center gap-0.5 rounded-full px-2 text-[17px] font-medium text-brand">
          <ChevronRightIcon size={22} className="rotate-180" />
          {t('Back')}
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">{title}</p>
        <span className="w-11" aria-hidden />
      </div>

      <main className="screen mx-auto max-w-lg space-y-4 px-4 pb-8 pt-2" style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))' }}>
        {error && <ErrorCard error={error} onRetry={() => setReloadKey((k) => k + 1)} />}
        {!team && !error && (
          <div className="space-y-4">
            <Skeleton className="h-52 w-full rounded-card" />
            <Skeleton className="h-32 w-full rounded-card" />
          </div>
        )}

        {team && showProfile && member && <Profile member={member} />}

        {team && (!showProfile || !member) && (
          <>
            <div className="px-1">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{t('Editorial team')}</h1>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {t('Licensed professionals who review PillSeek content for accuracy against FDA, DailyMed and RxNorm sources.')}
              </p>
            </div>
            {showProfile && !member && (
              <Card tone="warn" className="text-[14px] text-body">
                {t("That reviewer profile isn't available. Here is the current team.")}
              </Card>
            )}
            <Card padded={false} className="divide-y divide-line overflow-hidden">
              {team.length === 0 && <p className="px-4 py-6 text-center text-[15px] text-muted">{t('No team members listed yet.')}</p>}
              {team.map((m) => (
                <button
                  key={m.slug ?? m.name}
                  type="button"
                  onClick={() => {
                    void hapticTick()
                    if (m.slug) navigate(`/editorial-team/${encodeURIComponent(m.slug)}`)
                  }}
                  className="pressable flex w-full items-center gap-3 px-4 py-3 text-left active:bg-brand-tint"
                >
                  <Avatar member={m} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold text-ink">
                      {m.name}
                      {m.credentials && <span className="font-normal text-muted">, {m.credentials}</span>}
                    </span>
                    <span className="block text-[13px] text-muted">{[roleText(m.role), m.specialty].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ChevronRightIcon size={20} className="flex-none text-muted" />
                </button>
              ))}
            </Card>
            <Card tone="tint" className="text-[14px] leading-relaxed text-body">
              {t(
                'Pill identification data on PillSeek is pulled verbatim from government sources. Our team does not author drug content; it verifies that what you see matches the FDA label.',
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
