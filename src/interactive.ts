import { openInBrowser } from './browser.js'
import { countComments, header, hnUrl, plural, storyLink, storyLines, threadLines } from './format.js'
import { fetchThread, type Story, type Thread } from './hn.js'
import { listenToKeys, type Key } from './keyboard.js'
import { color, screen, terminalHeight, terminalWidth, truncate } from './terminal.js'

type Loadable<T> = { state: 'loading' } | { state: 'done'; value: T } | { state: 'error'; message: string }

interface CommentsView {
  story: Story
  scroll: number
  renderedLines: { width: number; lines: string[] } | null
}

const keyHint = (key: string, label: string): string => `${color.orange(`[${key}]`)} ${color.gray(label)}`

const divider = (width: number): string => ' ' + color.gray('─'.repeat(width - 2))

export function runInteractive(title: string, stories: Story[]): Promise<void> {
  const rankWidth = String(stories.length).length
  const threads = new Map<number, Loadable<Thread>>()

  let cursor = 0
  let firstVisible = 0
  let listPageSize = 1
  let commentsPageSize = 1
  let statusMessage = ''
  let commentsView: CommentsView | null = null
  let closed = false

  const render = () => {
    if (!closed) screen.draw(commentsView ? commentsScreen(commentsView) : listScreen())
  }

  function listScreen(): string[] {
    const width = terminalWidth()
    const height = terminalHeight()
    const lines = ['', header(title, plural(stories.length, 'story')), '']
    const footer = [
      divider(width),
      statusMessage ? ` ${statusMessage}` : '',
      ' ' + [keyHint('↑/↓', 'Navigate'), keyHint('Enter', 'Open'), keyHint('c', 'Comments'), keyHint('q', 'Quit')].join('  '),
    ]

    listPageSize = Math.max(1, Math.floor((height - lines.length - footer.length) / 3))
    if (cursor < firstVisible) firstVisible = cursor
    if (cursor >= firstVisible + listPageSize) firstVisible = cursor - listPageSize + 1
    firstVisible = Math.max(0, Math.min(firstVisible, stories.length - listPageSize))

    if (stories.length === 0) lines.push(color.gray('  No stories to show.'))
    stories.slice(firstVisible, firstVisible + listPageSize).forEach((story, offset) => {
      const index = firstVisible + offset
      lines.push(...storyLines(story, index + 1, { width, rankWidth, selected: index === cursor }), '')
    })
    while (lines.length < height - footer.length) lines.push('')
    return [...lines.slice(0, height - footer.length), ...footer]
  }

  function commentsScreen(view: CommentsView): string[] {
    const width = terminalWidth()
    const height = terminalHeight()
    const thread = threads.get(view.story.id)
    const detail = thread?.state === 'done' ? plural(countComments(thread.value.comments), 'comment') : `#${view.story.id}`
    const headerLines = ['', header('Discussion', detail), '']

    let bodyLines: string[]
    if (!thread || thread.state === 'loading') bodyLines = [color.gray('  Loading comments...')]
    else if (thread.state === 'error') bodyLines = [color.red(`  ${thread.message}`)]
    else {
      if (view.renderedLines?.width !== width) view.renderedLines = { width, lines: threadLines(thread.value, width) }
      bodyLines = view.renderedLines.lines
    }

    const bodyHeight = height - headerLines.length - 2
    commentsPageSize = Math.max(1, bodyHeight - 1)
    view.scroll = Math.max(0, Math.min(view.scroll, bodyLines.length - bodyHeight))
    const visibleLines = bodyLines.slice(view.scroll, view.scroll + bodyHeight)
    while (visibleLines.length < bodyHeight) visibleLines.push('')
    const scrollPercent =
      bodyLines.length > bodyHeight ? color.gray(`  ${Math.round(((view.scroll + bodyHeight) / bodyLines.length) * 100)}%`) : ''
    const hints = [keyHint('↑/↓', 'Scroll'), keyHint('PgUp/PgDn', 'Page'), keyHint('Enter', 'Open link'), keyHint('o', 'Open on HN'), keyHint('Esc', 'Back')]
    return [...headerLines, ...visibleLines, divider(width), ' ' + hints.join('  ') + scrollPercent]
  }

  const openLink = async (url: string) => {
    const opened = await openInBrowser(url)
    statusMessage = opened ? color.gray(`Opened ${truncate(url, 60)}`) : color.red(`Could not open the browser. Link: ${url}`)
    render()
  }

  const loadThread = async (story: Story) => {
    threads.set(story.id, { state: 'loading' })
    try {
      threads.set(story.id, { state: 'done', value: await fetchThread(story.id) })
    } catch (error) {
      threads.set(story.id, { state: 'error', message: (error as Error).message })
    }
    render()
  }

  return new Promise((resolve) => {
    let stopListening = () => {}
    const onResize = () => render()
    const onExit = () => screen.leave()

    const finish = () => {
      closed = true
      stopListening()
      process.stdout.off('resize', onResize)
      process.off('exit', onExit)
      screen.leave()
      resolve()
    }

    const onCommentsKey = (key: Key, view: CommentsView) => {
      switch (key.name) {
        case 'up':
        case 'k':
          view.scroll -= 1
          break
        case 'down':
        case 'j':
          view.scroll += 1
          break
        case 'pageup':
          view.scroll -= commentsPageSize
          break
        case 'pagedown':
        case 'space':
          view.scroll += commentsPageSize
          break
        case 'home':
          view.scroll = 0
          break
        case 'end':
          view.scroll = Number.MAX_SAFE_INTEGER
          break
        case 'o':
          void openLink(hnUrl(view.story.id))
          break
        case 'return':
        case 'enter':
          void openLink(storyLink(view.story))
          break
        case 'escape':
        case 'q':
        case 'left':
        case 'backspace':
          commentsView = null
          break
      }
    }

    const onListKey = (key: Key) => {
      const selected = stories[cursor]
      statusMessage = ''
      switch (key.name) {
        case 'up':
        case 'k':
          cursor -= 1
          break
        case 'down':
        case 'j':
          cursor += 1
          break
        case 'pageup':
          cursor -= listPageSize
          break
        case 'pagedown':
          cursor += listPageSize
          break
        case 'home':
          cursor = 0
          break
        case 'end':
          cursor = stories.length - 1
          break
        case 'return':
        case 'enter':
          if (selected) void openLink(storyLink(selected))
          break
        case 'c':
          if (!selected) break
          commentsView = { story: selected, scroll: 0, renderedLines: null }
          if (threads.get(selected.id)?.state !== 'done') void loadThread(selected)
          break
        case 'q':
        case 'escape':
          finish()
          return
      }
      cursor = Math.max(0, Math.min(cursor, stories.length - 1))
    }

    stopListening = listenToKeys((key) => {
      if (key.ctrl && key.name === 'c') return finish()
      if (commentsView) onCommentsKey(key, commentsView)
      else onListKey(key)
      render()
    })
    process.stdout.on('resize', onResize)
    process.on('exit', onExit)
    screen.enter()
    render()
  })
}
