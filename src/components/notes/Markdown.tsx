import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from 'react-router-dom'
import { wikilinksToMarkdown } from '@/lib/wikilinks'
import { cn } from '@/lib/utils'





export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate()
  return (
    <div className={cn('prose-note text-[15px]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('wikilink:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('wikilink:')) {
              const name = decodeURIComponent(href.slice('wikilink:'.length))
              return (
                <a
                  href="#"
                  className="wikilink"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigate(`/graph?concept=${encodeURIComponent(name)}`)
                  }}
                >
                  {children}
                </a>
              )
            }
            if (!href) return <span>{children}</span>
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            )
          },
          img: ({ alt }) => <span className="text-muted-foreground">[image: {alt}]</span>,
        }}
      >
        {wikilinksToMarkdown(text)}
      </ReactMarkdown>
    </div>
  )
})
