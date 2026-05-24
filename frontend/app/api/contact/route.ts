import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ContactPayload = {
  name?: string
  email?: string
  subject?: string
  body?: string
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getConfiguredRecipient(): string {
  return process.env.CONTACT_FORM_TO_EMAIL || 'contact@pillseek.com'
}

function buildPlainTextMessage(payload: Required<ContactPayload>): string {
  return [
    'New PillSeek contact form submission',
    '',
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Subject: ${payload.subject}`,
    '',
    'Message:',
    payload.body,
  ].join('\n')
}

async function sendViaResend({
  to,
  replyTo,
  subject,
  text,
}: {
  to: string
  replyTo: string
  subject: string
  text: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.CONTACT_FORM_FROM_EMAIL

  if (!apiKey || !from) {
    throw new Error('Missing RESEND_API_KEY or CONTACT_FORM_FROM_EMAIL')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject,
      text,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Resend request failed: ${response.status} ${errorBody}`)
  }
}

export async function POST(req: Request) {
  let payload: ContactPayload

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const name = normalize(payload.name)
  const email = normalize(payload.email)
  const subject = normalize(payload.subject)
  const body = normalize(payload.body)

  if (!name || !email || !subject || !body) {
    return NextResponse.json(
      { error: 'Please complete name, email, subject, and message.' },
      { status: 400 }
    )
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const provider = normalize(process.env.CONTACT_FORM_PROVIDER).toLowerCase()

  if (provider !== 'resend') {
    return NextResponse.json(
      {
        error:
          'Contact form email delivery is not configured yet. Set CONTACT_FORM_PROVIDER=resend and required email env vars.',
      },
      { status: 503 }
    )
  }

  const recipient = getConfiguredRecipient()
  const emailSubject = `[PillSeek Contact] ${subject}`
  const text = buildPlainTextMessage({ name, email, subject, body })

  try {
    await sendViaResend({
      to: recipient,
      replyTo: email,
      subject: emailSubject,
      text,
    })

    return NextResponse.json({ ok: true, message: 'Message submitted successfully.' })
  } catch (error) {
    console.error('Contact form submission failed', error)
    return NextResponse.json(
      { error: 'Unable to send your message right now. Please try again later.' },
      { status: 500 }
    )
  }
}
