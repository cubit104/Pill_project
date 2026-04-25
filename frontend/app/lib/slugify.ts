export function slugify(input: string): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')        // any non-alphanumeric -> hyphen
    .replace(/^-+|-+$/g, '')            // trim leading/trailing hyphens
}

export function unslugify(slug: string): string {
  return (slug || '').replace(/-+/g, ' ').trim()
}
