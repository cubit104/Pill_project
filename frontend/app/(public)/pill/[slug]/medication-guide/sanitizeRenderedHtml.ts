const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
const EVENT_HANDLER_ATTR_RE = /\son[a-z]+\s*=\s*(['"]).*?\1/gi
const EVENT_HANDLER_UNQUOTED_ATTR_RE = /\son[a-z]+\s*=\s*[^\s>]+/gi
const JS_PROTOCOL_QUOTED_RE = /\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi
const JS_PROTOCOL_UNQUOTED_RE = /\s(href|src)\s*=\s*javascript:[^\s>]+/gi

export function sanitizeRenderedHtml(html: string): string {
  return html
    .replace(SCRIPT_TAG_RE, '')
    .replace(EVENT_HANDLER_ATTR_RE, '')
    .replace(EVENT_HANDLER_UNQUOTED_ATTR_RE, '')
    .replace(JS_PROTOCOL_QUOTED_RE, '')
    .replace(JS_PROTOCOL_UNQUOTED_RE, '')
}
