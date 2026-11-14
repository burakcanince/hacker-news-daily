import { decodeHtml } from './format.js'

const FIREBASE_API = 'https://hacker-news.firebaseio.com/v0'
const ALGOLIA_API = 'https://hn.algolia.com/api/v1'

export type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'jobs'

export const FEEDS: Record<Feed, { path: string; title: string }> = {
  top: { path: 'topstories', title: 'Top Stories' },
  new: { path: 'newstories', title: 'New Stories' },
  best: { path: 'beststories', title: 'Best Stories' },
  ask: { path: 'askstories', title: 'Ask HN' },
  show: { path: 'showstories', title: 'Show HN' },
  jobs: { path: 'jobstories', title: 'Jobs' },
}

export interface Story {
  id: number
  type: string
  title: string
  url: string | null
  author: string
  points: number
  commentCount: number
  time: number
  text: string
}

export interface Comment {
  id: number
  author: string
  time: number
  text: string
  replies: Comment[]
}

export interface Thread {
  story: Story
  comments: Comment[]
}

interface FirebaseItem {
  id: number
  type?: string
  by?: string
  time?: number
  title?: string
  url?: string
  text?: string
  score?: number
  descendants?: number
  kids?: number[]
  deleted?: boolean
  dead?: boolean
}

interface AlgoliaItem {
  id: number
  author?: string | null
  text?: string | null
  created_at_i?: number
  children?: AlgoliaItem[]
}

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const host = new URL(url).host
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'hn-daily' } })
  } catch (error) {
    const reason = (error as Error).name === 'TimeoutError' ? 'the request timed out' : (error as Error).message
    throw new Error(`Could not reach ${host}: ${reason}`)
  }
  if (!response.ok) throw new Error(`${host} answered with status ${response.status}`)
  return (await response.json()) as T
}

async function fetchItem(id: number): Promise<FirebaseItem | null> {
  try {
    return await fetchJson<FirebaseItem | null>(`${FIREBASE_API}/item/${id}.json`)
  } catch {
    return null
  }
}

function toStory(item: FirebaseItem | null): Story | null {
  if (!item || item.deleted || item.dead || !item.title) return null
  return {
    id: item.id,
    type: item.type ?? 'story',
    title: decodeHtml(item.title),
    url: item.url ?? null,
    author: item.by ?? '',
    points: item.score ?? 0,
    commentCount: item.descendants ?? 0,
    time: item.time ?? 0,
    text: decodeHtml(item.text),
  }
}

interface StoryQuery {
  feed: Feed
  count: number
  shouldInclude?: (story: Story) => boolean
  onProgress?: (checked: number, total: number) => void
}

export async function fetchStories({ feed, count, shouldInclude, onProgress }: StoryQuery): Promise<Story[]> {
  const storyIds = await fetchJson<number[]>(`${FIREBASE_API}/${FEEDS[feed].path}.json`)
  const stories: Story[] = []
  const batchSize = shouldInclude ? 40 : Math.min(Math.max(count, 10), 40)
  for (let start = 0; start < storyIds.length && stories.length < count; start += batchSize) {
    const items = await Promise.all(storyIds.slice(start, start + batchSize).map(fetchItem))
    for (const story of items.map(toStory)) {
      if (story && (!shouldInclude || shouldInclude(story))) stories.push(story)
    }
    onProgress?.(Math.min(start + batchSize, storyIds.length), storyIds.length)
  }
  return stories.slice(0, count)
}

function toComment(item: AlgoliaItem, depth: number, maxDepth: number): Comment | null {
  const replies =
    depth < maxDepth
      ? (item.children ?? []).map((child) => toComment(child, depth + 1, maxDepth)).filter((reply): reply is Comment => reply !== null)
      : []
  const text = decodeHtml(item.text)
  if (!item.author && !text && replies.length === 0) return null
  return { id: item.id, author: item.author ?? '[deleted]', time: item.created_at_i ?? 0, text: text || '[deleted]', replies }
}

export async function fetchThread(id: number, maxDepth = Infinity): Promise<Thread> {
  const [storyItem, commentTree] = await Promise.all([
    fetchItem(id),
    fetchJson<AlgoliaItem>(`${ALGOLIA_API}/items/${id}`, 30000).catch((error: Error) => error),
  ])
  if (!storyItem) throw new Error(`No Hacker News item with id ${id}.`)
  if (storyItem.type === 'comment') throw new Error(`${id} is a comment. Pass the id of the story instead.`)
  const story = toStory(storyItem)
  if (!story) throw new Error(`Story ${id} was deleted or flagged.`)
  if (commentTree instanceof Error) throw commentTree

  const siteOrder = new Map((storyItem.kids ?? []).map((commentId, index) => [commentId, index]))
  const orderOf = (comment: Comment) => siteOrder.get(comment.id) ?? Number.MAX_SAFE_INTEGER
  const comments = (commentTree.children ?? [])
    .map((child) => toComment(child, 1, maxDepth))
    .filter((comment): comment is Comment => comment !== null)
    .sort((a, b) => orderOf(a) - orderOf(b))
  return { story, comments }
}

export function parseItemId(input: string): number | null {
  const urlMatch = /news\.ycombinator\.com\/item\?(?:.*&)?id=(\d+)/i.exec(input)
  const id = Number(urlMatch ? urlMatch[1] : input.replace(/^#/, ''))
  return Number.isInteger(id) && id > 0 ? id : null
}
