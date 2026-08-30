const LINK_PATTERN = /(https?:\/\/[^\s<]+)/gi
const TRAILING_PUNCTUATION = /[),.!?;:]+$/

export interface CommentTextSegment {
  text: string
  url?: string
}

export function splitCommentLinks(body: string): CommentTextSegment[] {
  return body.split(LINK_PATTERN).filter(Boolean).flatMap((part) => {
    if (!/^https?:\/\//i.test(part)) return [{ text: part }]
    const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    const url = trailing ? part.slice(0, -trailing.length) : part
    return [
      { text: url, url },
      ...(trailing ? [{ text: trailing }] : [])
    ]
  })
}

export function CommentBody({ body }: { body: string }): React.JSX.Element {
  return (
    <p className="discussion-message-body">
      {splitCommentLinks(body).map((segment, index) => segment.url
        ? <a href={segment.url} key={`${segment.url}-${index}`} rel="noreferrer" target="_blank">{segment.text}</a>
        : <span key={`${segment.text}-${index}`}>{segment.text}</span>)}
    </p>
  )
}
