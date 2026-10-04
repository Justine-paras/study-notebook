// Renders AI and learner Markdown: GFM tables and task lists, $math$ with
// KaTeX, code blocks with a language label and copy button. Raw HTML is
// never rendered (it shows as plain text), so lesson content cannot inject
// markup into the app.

import { memo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Check, Copy } from 'lucide-react'
import './Markdown.css'

export interface MarkdownProps {
  /** The Markdown source. */
  children: string
  /** default 15px; lesson 16px with roomy line height (reading on a Sheet); compact 14px (cards, feedback). */
  variant?: 'default' | 'lesson' | 'compact'
  /** Render paragraphs inline (for short prompts and options inside other text). */
  inline?: boolean
  className?: string
}

interface MdNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: MdNode[]
}

/** remark plugin: turns raw HTML nodes into literal text ("use <vector>" stays visible). */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text'
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

function textOf(node: MdNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function languageOf(code: MdNode | undefined): string | null {
  const className = code?.properties?.className
  const classes = Array.isArray(className) ? className.map(String) : typeof className === 'string' ? className.split(' ') : []
  const lang = classes.find((c) => c.startsWith('language-'))
  return lang ? lang.slice('language-'.length) : null
}

const LANGUAGE_NAMES: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Bash',
  shell: 'Shell',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  text: 'Text',
  pseudo: 'Pseudocode',
  pseudocode: 'Pseudocode'
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for when the async clipboard is unavailable (window not focused).
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

export function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [copied, setCopied] = useState(false)
  const label = language ? (LANGUAGE_NAMES[language.toLowerCase()] ?? language) : 'Code'
  return (
    <div className="md__code">
      <div className="md__code-header">
        <span className="md__code-lang">{label}</span>
        <button
          type="button"
          className="md__copy"
          onClick={() => {
            void copyText(code).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            })
          }}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
          <span className="sr-only" aria-live="polite">
            {copied ? 'Code copied' : ''}
          </span>
        </button>
      </div>
      <pre className="md__pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

const EXTERNAL_URL = /^(https?:|mailto:)/i

function MdLink({ href, children, node: _node, ...rest }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  void _node
  const external = !!href && EXTERNAL_URL.test(href)
  // target=_blank makes Electron's window-open handler open the system browser.
  return (
    <a {...rest} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer noopener' : undefined}>
      {children}
    </a>
  )
}

function MdPre({ node }: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const code = (node as MdNode | undefined)?.children?.find((child) => child.tagName === 'code')
  const text = textOf(code).replace(/\n$/, '')
  return <CodeBlock code={text} language={languageOf(code)} />
}

function MdTable({ children, node: _node, ...rest }: ComponentPropsWithoutRef<'table'> & ExtraProps) {
  void _node
  return (
    <div className="md__table-scroll" tabIndex={0} role="region" aria-label="Table">
      <table {...rest}>{children}</table>
    </div>
  )
}

function MdImage({ alt }: ComponentPropsWithoutRef<'img'> & ExtraProps) {
  // Remote images are blocked by the CSP and lessons never need them: show the alt text.
  return alt ? <span className="md__image-alt">[{alt}]</span> : null
}

function InlineParagraph({ children }: { children?: ReactNode }) {
  return <span className="md__inline-p">{children}</span>
}

const BLOCK_COMPONENTS: Components = { a: MdLink, pre: MdPre, table: MdTable, img: MdImage }
const INLINE_COMPONENTS: Components = { ...BLOCK_COMPONENTS, p: InlineParagraph }

const REMARK_PLUGINS = [remarkHtmlAsText, remarkGfm, remarkMath]
const REHYPE_PLUGINS: NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']> = [
  [rehypeKatex, { throwOnError: false, strict: false, output: 'htmlAndMathml' }]
]

/**
 * `<Markdown variant="lesson">{chunk.body}</Markdown>`
 * `<Markdown inline>{question.prompt}</Markdown>`
 */
export const Markdown = memo(function Markdown({ children, variant = 'default', inline = false, className }: MarkdownProps) {
  const Tag = inline ? 'span' : 'div'
  return (
    <Tag className={['md', `md--${variant}`, inline && 'md--inline', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={inline ? INLINE_COMPONENTS : BLOCK_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </Tag>
  )
})
