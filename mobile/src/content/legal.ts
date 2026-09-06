/**
 * Legal pages rendered natively. Text mirrors the website pages
 * (frontend/app/(public)/privacy, /terms, /medical-disclaimer) — keep both in
 * sync when either changes.
 */

export type LegalKind = 'privacy' | 'terms' | 'disclaimer'

export type LegalBlock =
  | { type: 'h'; text: string }
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'callout'; tone: 'danger' | 'warn'; text: string }
  | { type: 'link'; text: string; to: string }
  | { type: 'faq'; items: Array<{ q: string; a: string }> }

export interface LegalDoc {
  title: string
  sitePath: string
  lastUpdated: string | null
  blocks: LegalBlock[]
}

export function isLegalKind(v: string | null | undefined): v is LegalKind {
  return v === 'privacy' || v === 'terms' || v === 'disclaimer'
}

export const LEGAL: Record<LegalKind, LegalDoc> = {
  privacy: {
    title: 'Privacy Policy',
    sitePath: '/privacy',
    lastUpdated: 'April 2025',
    blocks: [
      { type: 'h', text: '1. Overview' },
      {
        type: 'p',
        text: 'PillSeek ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you use pillseek.com and the PillSeek app (the "Service").',
      },
      { type: 'h', text: '2. Information We Collect' },
      { type: 'p', text: 'PillSeek does not require account creation or collect personally identifiable information to use the pill identifier. We may collect:' },
      {
        type: 'list',
        items: [
          'Usage data: standard server logs including IP addresses, device type, pages visited, and timestamps. This data is used for security and to improve the service.',
          'Search queries: the search terms you enter (imprint codes, drug names, etc.) to return results. We do not store these queries linked to any personal identifier.',
          'Photos you choose to keep: if you turn on "Keep my photos to improve the reader" in the app, pill photos are stored without any personal details and used only to train PillSeek\'s imprint reader. This is off unless you switch it on, and photos are otherwise analysed in memory and discarded.',
        ],
      },
      { type: 'h', text: '3. How We Use Information' },
      {
        type: 'p',
        text: 'We use collected information solely to: operate and improve the Service, monitor for security threats and abuse, and analyze usage patterns (in aggregate) to improve search quality. We do not sell, rent, or share your data with third parties for marketing purposes.',
      },
      { type: 'h', text: '4. Cookies' },
      {
        type: 'p',
        text: 'PillSeek uses only essential session cookies required for the Service to function. We do not use tracking cookies, advertising cookies, or third-party analytics cookies that identify you personally.',
      },
      { type: 'h', text: '5. Data Retention' },
      { type: 'p', text: 'Server access logs are retained for up to 90 days for security purposes, then deleted. No personal health information is stored by PillSeek.' },
      { type: 'h', text: '6. Your Rights' },
      {
        type: 'p',
        text: 'Since we do not collect personally identifiable information, there is typically no personal data to access or delete. If you have questions about data collected via server logs, please contact us.',
      },
      { type: 'link', text: 'Contact us', to: '/contact' },
      { type: 'h', text: '7. Changes to This Policy' },
      {
        type: 'p',
        text: 'We may update this Privacy Policy from time to time. We will post the updated policy with a revised "Last updated" date. Continued use of the Service after changes constitutes acceptance of the new policy.',
      },
      { type: 'h', text: '8. Contact' },
      { type: 'p', text: 'For privacy-related questions, contact us at contact@pillseek.com.' },
    ],
  },
  terms: {
    title: 'Terms of Use',
    sitePath: '/terms',
    lastUpdated: 'April 2025',
    blocks: [
      { type: 'h', text: '1. Acceptance of Terms' },
      { type: 'p', text: 'By accessing or using PillSeek ("the Service"), you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use the Service.' },
      { type: 'h', text: '2. Educational Use Only' },
      {
        type: 'p',
        text: 'PillSeek is provided for educational and informational purposes only. The Service is designed to help identify medications by physical characteristics and imprint codes. It is not intended to be used as a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a qualified healthcare professional with any questions you may have regarding a medical condition or medication.',
      },
      { type: 'h', text: '3. Accuracy of Information' },
      {
        type: 'p',
        text: 'While we strive to provide accurate information sourced from the FDA and DailyMed, PillSeek makes no warranty, express or implied, regarding the accuracy, completeness, or currency of any information on the Service. Drug databases are complex and may contain errors. Always confirm medication identification with a licensed pharmacist.',
      },
      { type: 'h', text: '4. Limitation of Liability' },
      {
        type: 'p',
        text: 'To the maximum extent permitted by law, PillSeek and its operators shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from your use of or inability to use the Service, or from any errors or omissions in the content.',
      },
      { type: 'h', text: '5. Prohibited Uses' },
      { type: 'p', text: 'You agree not to:' },
      {
        type: 'list',
        items: [
          'Use the Service for any unlawful purpose',
          'Scrape, bulk-download, or systematically extract data without permission',
          'Misrepresent medication identity information from this Service to others',
          'Attempt to circumvent or disrupt the operation of the Service',
        ],
      },
      { type: 'h', text: '6. Changes to Terms' },
      { type: 'p', text: 'We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the revised Terms.' },
      { type: 'h', text: '7. Contact' },
      { type: 'p', text: 'Questions about these Terms? Contact us at contact@pillseek.com.' },
    ],
  },
  disclaimer: {
    title: 'Medical Disclaimer',
    sitePath: '/medical-disclaimer',
    lastUpdated: null,
    blocks: [
      {
        type: 'callout',
        tone: 'danger',
        text: 'PillSeek is for educational and identification purposes only. It is not medical advice and must not be used as a substitute for professional medical advice, diagnosis, or treatment. Always consult a licensed pharmacist or physician before making any medication decision.',
      },
      { type: 'h', text: 'Purpose of PillSeek' },
      {
        type: 'p',
        text: 'PillSeek is a pill identification reference tool. It is designed to help patients, caregivers, and healthcare professionals visually identify medications by their physical characteristics (color, shape, imprint code).',
      },
      { type: 'p', text: 'PillSeek does not:' },
      {
        type: 'list',
        items: ['Provide dosing recommendations', 'Provide medical advice or treatment plans', 'Diagnose any medical condition', 'Replace a licensed healthcare provider'],
      },
      { type: 'h', text: 'Emergency Situations' },
      { type: 'p', text: 'If you believe someone has taken an unknown medication or overdosed:' },
      { type: 'list', items: ['Call 911 (or your local emergency services) immediately', 'Contact Poison Control at 1-800-222-1222 (US)'] },
      { type: 'h', text: 'Always Consult a Professional' },
      {
        type: 'p',
        text: 'Even after identifying a medication using PillSeek, always confirm the identification with a licensed pharmacist. Pill appearances can be similar across different medications, and database errors can occur. A pharmacist can verify the medication and advise whether it is safe and appropriate for you.',
      },
      { type: 'h', text: 'Data Sources and Accuracy' },
      {
        type: 'p',
        text: 'PillSeek data is sourced from the FDA National Drug Code (NDC) Directory and DailyMed. While these are authoritative sources, PillSeek makes no warranty regarding the accuracy, completeness, or currency of the information displayed. Medication formulations can change, and some older entries may be outdated.',
      },
      { type: 'link', text: 'View our data sources', to: 'https://pillseek.com/sources' },
      { type: 'h', text: 'Frequently Asked Questions' },
      {
        type: 'faq',
        items: [
          {
            q: 'Can I use PillSeek to identify a medication and take it?',
            a: 'No. Pill identification is only the first step. Even after identifying a medication, you should consult a licensed pharmacist or physician before taking any medication, especially if you are unsure whether it is appropriate for you.',
          },
          {
            q: 'What should I do if I find an unknown pill?',
            a: 'If you find an unknown pill, you can use PillSeek to help identify it visually. However, always confirm with a licensed pharmacist. If someone may have ingested an unknown substance, contact Poison Control (1-800-222-1222 in the US) or emergency services immediately.',
          },
          {
            q: 'Is PillSeek data accurate?',
            a: 'PillSeek sources data directly from the FDA NDC Directory and DailyMed. While we strive for accuracy, drug databases can contain errors. Always confirm medication identification with a licensed pharmacist before relying on it for any medical decision.',
          },
          {
            q: 'Does PillSeek provide dosing information?',
            a: 'No. PillSeek displays basic drug information as filed with the FDA (strength, ingredients, form) but does not provide dosing instructions, treatment recommendations, or medical advice of any kind.',
          },
        ],
      },
    ],
  },
}
