import type { Comment, Story, Thread } from './hn.js'
import { color, truncate, visibleLength, wrap } from './terminal.js'

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? entity
  })
}

export function decodeHtml(html?: string | null): string {
  if (!html) return ''
  return decodeEntities(
    html
      .replace(/<p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>.*?<\/a>/gis, (_link, href: string) => href)
      .replace(/<[^>]*>/g, ''),
  ).trim()
}

export const hnUrl = (id: number): string => `https://news.ycombinator.com/item?id=${id}`

export const storyLink = (story: Story): string => story.url ?? hnUrl(story.id)

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

function timeAgo(seconds: number): string {
  if (!seconds) return ''
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - seconds))
  if (elapsed < 60) return 'just now'
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`
  if (elapsed < 86400 * 30) return `${Math.floor(elapsed / 86400)}d ago`
  if (elapsed < 86400 * 365) return `${Math.floor(elapsed / (86400 * 30))}mo ago`
  return `${Math.floor(elapsed / (86400 * 365))}y ago`
}

function domainOf(url: string | null): string {
  if (!url) return ''
  const match = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)
  return match ? match[1] : ''
}

export function parseFilter(input: string | undefined): string[] {
  return (input ?? '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function matchesFilter(story: Story, words: string[]): boolean {
  if (words.length === 0) return true
  const searchText = `${story.title} ${domainOf(story.url)}`
  return words.some((word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(searchText))
}

export function logo(text: string): string {
  return ` ${color.badge(' Y ')}  ${text}`
}

export function header(title: string, detail: string): string {
  return logo(`${color.bold(`Hacker News ${title}`)}  ${color.gray(detail)}`)
}

export function plural(count: number, word: string): string {
  if (count === 1) return `1 ${word}`
  return `${count} ${word.endsWith('y') ? word.slice(0, -1) + 'ies' : word + 's'}`
}

function storyDetails(story: Story): string[] {
  const isJob = story.type === 'job'
  return [
    isJob ? '' : color.orange(`▲ ${story.points}`) + ' ' + color.white('pts'),
    story.author ? `${color.white('by')} ${color.cyan(story.author)}` : '',
    color.white(timeAgo(story.time)),
    isJob ? '' : color.white(plural(story.commentCount, 'comment')),
  ].filter(Boolean)
}

interface StoryLineOptions {
  width: number
  rankWidth: number
  selected?: boolean
}

export function storyLines(story: Story, rank: number, { width, rankWidth, selected = false }: StoryLineOptions): string[] {
  const rankLabel = `${String(rank).padStart(rankWidth)}.`
  const domain = domainOf(story.url)
  const domainLabel = domain ? ` (${domain})` : ''
  const title = truncate(story.title, width - 3 - rankLabel.length - domainLabel.length)
  const marker = selected ? color.orange('❯') : ' '
  const titleLine = `${marker} ${selected ? color.orange(color.bold(rankLabel)) : color.gray(rankLabel)} ${
    selected ? color.white(color.bold(title)) : color.bold(title)
  }${color.gray(domainLabel)}`
  const details = [...storyDetails(story), color.white(`#${story.id}`)]
  return [titleLine, ' '.repeat(3 + rankLabel.length) + details.join(color.white(' · '))]
}

export function renderStoryList(title: string, stories: Story[], width: number): string {
  const lines = ['', header(title, plural(stories.length, 'story')), '']
  const rankWidth = String(stories.length).length
  const indent = ' '.repeat(4 + rankWidth)
  stories.forEach((story, index) => {
    lines.push(...storyLines(story, index + 1, { width, rankWidth }))
    lines.push(indent + color.gray(truncate(storyLink(story), width - indent.length)), '')
  })
  if (stories.length === 0) lines.push(color.gray('  No stories matched.'), '')
  else lines.push(color.gray('  Read the discussion: hn-daily comments <id>'), '')
  return lines.join('\n')
}

function addCommentTree(comments: Comment[], prefix: string, width: number, lines: string[]): void {
  comments.forEach((comment, index) => {
    const isLast = index === comments.length - 1
    lines.push(prefix + color.gray(isLast ? '└─ ' : '├─ ') + color.cyan(color.bold(comment.author)) + color.gray(` · ${timeAgo(comment.time)}`))
    const childPrefix = prefix + color.gray(isLast ? '   ' : '│  ')
    const textWidth = Math.max(20, width - visibleLength(childPrefix))
    splitParagraphs(comment.text).forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) lines.push(childPrefix)
      for (const line of wrap(paragraph, textWidth)) lines.push(childPrefix + line)
    })
    lines.push(childPrefix)
    addCommentTree(comment.replies, childPrefix, width, lines)
  })
}

export function countComments(comments: Comment[]): number {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies), 0)
}

export function threadLines({ story, comments }: Thread, width: number): string[] {
  const lines: string[] = []
  const domain = domainOf(story.url)
  for (const line of wrap(story.title, width - 4)) lines.push('  ' + color.bold(line))
  const details = [...storyDetails(story), domain ? color.gray(domain) : ''].filter(Boolean)
  lines.push('  ' + details.join(color.white(' · ')))
  lines.push('  ' + color.gray(hnUrl(story.id)))
  if (story.text) {
    lines.push('')
    for (const paragraph of splitParagraphs(story.text)) {
      for (const line of wrap(paragraph, width - 4)) lines.push('  ' + line)
      lines.push('')
    }
  }
  lines.push('')
  if (comments.length === 0) lines.push(color.gray('  No comments yet.'))
  addCommentTree(comments, ' ', width - 1, lines)
  return lines.map((line) => line.trimEnd())
}

const toIsoTime = (seconds: number): string | null => (seconds ? new Date(seconds * 1000).toISOString() : null)

function storyFields(story: Story) {
  return {
    id: story.id,
    title: story.title,
    url: story.url,
    domain: domainOf(story.url) || null,
    points: story.points,
    commentCount: story.commentCount,
    author: story.author,
    time: toIsoTime(story.time),
    hnUrl: hnUrl(story.id),
    ...(story.text ? { text: story.text } : {}),
  }
}

export function storiesToJson(stories: Story[]): string {
  return JSON.stringify(
    stories.map((story, index) => ({ rank: index + 1, ...storyFields(story) })),
    null,
    2,
  )
}

const escapeMarkdown = (text: string): string => text.replace(/([\\`*_[\]<>])/g, '\\$1')

export function storiesToMarkdown(title: string, stories: Story[]): string {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [`# Hacker News ${title}, ${date}`, '']
  stories.forEach((story, index) => {
    const domain = domainOf(story.url)
    lines.push(`${index + 1}. [${escapeMarkdown(story.title)}](${storyLink(story)})${domain ? ` (${domain})` : ''}  `)
    const details =
      story.type === 'job'
        ? `by ${story.author}`
        : `${story.points} points by ${story.author}, [${plural(story.commentCount, 'comment')}](${hnUrl(story.id)})`
    lines.push(`   ${details}`, '')
  })
  return lines.join('\n')
}

function commentFields(comment: Comment): object {
  return {
    id: comment.id,
    author: comment.author,
    time: toIsoTime(comment.time),
    text: comment.text,
    replies: comment.replies.map(commentFields),
  }
}

export function threadToJson({ story, comments }: Thread): string {
  return JSON.stringify({ story: storyFields(story), comments: comments.map(commentFields) }, null, 2)
}

function addCommentMarkdown(comments: Comment[], depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth)
  for (const comment of comments) {
    const [firstParagraph = '', ...otherParagraphs] = splitParagraphs(comment.text).map(escapeMarkdown)
    lines.push(`${indent}- **${escapeMarkdown(comment.author)}**: ${firstParagraph}`)
    for (const paragraph of otherParagraphs) lines.push('', `${indent}  ${paragraph}`)
    addCommentMarkdown(comment.replies, depth + 1, lines)
  }
}

export function threadToMarkdown({ story, comments }: Thread): string {
  const lines = [`# [${escapeMarkdown(story.title)}](${storyLink(story)})`, '']
  lines.push(`${story.points} points by ${story.author}, ${plural(story.commentCount, 'comment')}, [discussion](${hnUrl(story.id)})`, '')
  if (story.text) lines.push(...splitParagraphs(story.text).flatMap((paragraph) => [escapeMarkdown(paragraph), '']))
  addCommentMarkdown(comments, 0, lines)
  lines.push('')
  return lines.join('\n')
}
