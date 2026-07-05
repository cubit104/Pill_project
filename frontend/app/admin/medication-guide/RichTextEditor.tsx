'use client'

import { useEffect, useRef, useState } from 'react'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'

type RichTextEditorProps = {
  content: string
  onChange: (html: string) => void
  placeholder?: string
}

export default function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const [isSourceMode, setIsSourceMode] = useState(false)
  const [sourceHtml, setSourceHtml] = useState(content || '')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState('')
  const lastSyncedContentRef = useRef(content || '')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'min-h-[220px] p-3 text-sm focus:outline-none',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const html = nextEditor.getHTML()
      lastSyncedContentRef.current = html
      setSourceHtml(html)
      onChange(html)
    },
  })

  useEffect(() => {
    setSourceHtml(content || '')
    if (!isSourceMode && editor && content !== lastSyncedContentRef.current) {
      editor.commands.setContent(content || '', false)
      lastSyncedContentRef.current = content || ''
    }
  }, [content, editor, isSourceMode])

  // Sync source HTML back to Tiptap editor only when leaving source mode
  useEffect(() => {
    if (!isSourceMode && editor && sourceHtml !== lastSyncedContentRef.current) {
      editor.commands.setContent(sourceHtml || '', false)
      lastSyncedContentRef.current = sourceHtml || ''
    }
  }, [isSourceMode, editor, sourceHtml])

  const toolbarButton = (active: boolean) =>
    `px-2 py-1 border rounded text-sm ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`

  const openLinkEditor = () => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    setLinkInput(previous || '')
    setLinkError('')
    setShowLinkInput((prev) => !prev)
  }

  const applyLink = () => {
    if (!editor) return
    if (!linkInput.trim()) {
      editor.chain().focus().unsetLink().run()
      setShowLinkInput(false)
      setLinkError('')
      return
    }
    const rawValue = linkInput.trim()
    const href = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
    try {
      const validated = new URL(href)
      if (validated.protocol !== 'http:' && validated.protocol !== 'https:') {
        throw new Error('Invalid URL protocol')
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: validated.toString() }).run()
      setShowLinkInput(false)
      setLinkError('')
    } catch {
      setLinkError('Please enter a valid URL.')
    }
  }

  return (
    <div className="border border-gray-300 rounded-md bg-white overflow-hidden medguide-editor">
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-gray-200 bg-gray-50">
        <button type="button" aria-label="Bold" title="Bold" className={toolbarButton(!!editor?.isActive('bold'))} onClick={() => editor?.chain().focus().toggleBold().run()}>B</button>
        <button type="button" aria-label="Italic" title="Italic" className={toolbarButton(!!editor?.isActive('italic'))} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
        <button type="button" aria-label="Heading level 2" title="Heading level 2" className={toolbarButton(!!editor?.isActive('heading', { level: 2 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" aria-label="Heading level 3" title="Heading level 3" className={toolbarButton(!!editor?.isActive('heading', { level: 3 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" aria-label="Bullet list" title="Bullet list" className={toolbarButton(!!editor?.isActive('bulletList'))} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
        <button type="button" aria-label="Ordered list" title="Ordered list" className={toolbarButton(!!editor?.isActive('orderedList'))} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
        <button type="button" aria-label="Insert or edit link" title="Insert or edit link" className={toolbarButton(!!editor?.isActive('link') || showLinkInput)} onClick={openLinkEditor}>Link</button>
        <button type="button" aria-label="Toggle HTML source mode" title="Toggle HTML source mode" className={toolbarButton(isSourceMode)} onClick={() => setIsSourceMode((prev) => !prev)}>{'</>'}</button>
      </div>
      {showLinkInput && (
        <div className="px-2 py-2 border-b border-gray-200 bg-white space-y-1">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              className="flex-1 min-w-[220px] border border-gray-300 rounded px-2 py-1 text-sm"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://example.com"
            />
            <button type="button" className="px-2 py-1 border border-gray-300 rounded text-sm bg-white hover:bg-gray-50" onClick={applyLink}>Apply</button>
            <button
              type="button"
              className="px-2 py-1 border border-gray-300 rounded text-sm bg-white hover:bg-gray-50"
              onClick={() => {
                editor?.chain().focus().unsetLink().run()
                setShowLinkInput(false)
                setLinkError('')
              }}
            >
              Remove
            </button>
          </div>
          {linkError && <div className="text-xs text-red-600">{linkError}</div>}
        </div>
      )}

      {isSourceMode ? (
        <textarea
          className="w-full min-h-[220px] p-3 text-xs font-mono focus:outline-none"
          value={sourceHtml}
          placeholder={placeholder}
          onChange={(e) => {
            const nextHtml = e.target.value
            setSourceHtml(nextHtml)
            onChange(nextHtml)
          }}
        />
      ) : (
        <div className="relative">
          {placeholder && editor?.isEmpty && <span className="absolute left-3 top-3 text-sm text-gray-400 pointer-events-none">{placeholder}</span>}
          <EditorContent editor={editor} />
        </div>
      )}

      <style jsx global>{`
        .medguide-editor .ProseMirror h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; }
        .medguide-editor .ProseMirror h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
        .medguide-editor .ProseMirror p { margin: 0.5rem 0; }
        .medguide-editor .ProseMirror ul, .medguide-editor .ProseMirror ol { margin: 0.5rem 0; padding-left: 1.5rem; }
        .medguide-editor .ProseMirror ul { list-style-type: disc; }
        .medguide-editor .ProseMirror ol { list-style-type: decimal; }
        .medguide-editor .ProseMirror li { margin: 0.25rem 0; }
        .medguide-editor .ProseMirror a { color: #0369a1; text-decoration: underline; }
        .medguide-editor .ProseMirror strong { font-weight: 700; }
        .medguide-editor .ProseMirror em { font-style: italic; }
      `}</style>
    </div>
  )
}
