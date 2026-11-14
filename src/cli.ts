#!/usr/bin/env node
import fs from 'node:fs'
import { parseArgs } from 'node:util'
import {
  logo,
  matchesFilter,
  parseFilter,
  renderStoryList,
  storiesToJson,
  storiesToMarkdown,
  threadLines,
  threadToJson,
  threadToMarkdown,
} from './format.js'
import { FEEDS, fetchStories, fetchThread, parseItemId, type Feed, type Story } from './hn.js'
import { runInteractive } from './interactive.js'
import { color, terminalWidth } from './terminal.js'

const HELP = `
 ${logo(`${color.bold('hn-daily')}  Hacker News in your terminal.`)}

  ${color.bold('Usage')}
    hn-daily                      Today's top 10 stories
    hn-daily --top 20             Top 20 stories
    hn-daily --new | --best | --ask | --show | --jobs [n]
    hn-daily -i                   Browse with the arrow keys
    hn-daily comments <id|url>    Read a discussion as a tree

  ${color.bold('Options')}
    -n, --count <n>               Number of stories (default 10)
    -f, --filter <words>          Only stories about these words, e.g. rust,ai
    -i, --interactive             Arrow keys, Enter to open, c comments
        --json                    Print JSON
        --markdown, --md          Print Markdown
    -d, --depth <n>               Reply depth for "comments"
    -h, --help                    Show this help
    -v, --version                 Show the version
`

const FEED_FLAGS: Record<string, Feed> = {
  '--top': 'top',
  '--new': 'new',
  '--best': 'best',
  '--ask': 'ask',
  '--show': 'show',
  '--jobs': 'jobs',
}

function exitWithError(message: string): never {
  process.stderr.write(color.red(`hn-daily: ${message}`) + '\n')
  process.exit(1)
}

function readNumberOption(value: string | undefined, flag: string): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) exitWithError(`${flag} needs a whole number between 1 and 500.`)
  return parsed
}

function splitFeedFlags(args: string[]): { feed: Feed; count: number | null; otherArgs: string[] } {
  let feed: Feed = 'top'
  let count: number | null = null
  const otherArgs: string[] = []
  for (let index = 0; index < args.length; index++) {
    const [flag, inlineValue] = args[index].split('=', 2)
    const flagFeed = FEED_FLAGS[flag]
    if (!flagFeed) {
      otherArgs.push(args[index])
      continue
    }
    feed = flagFeed
    if (inlineValue !== undefined) count = readNumberOption(inlineValue, flag)
    else if (/^\d+$/.test(args[index + 1] ?? '')) count = readNumberOption(args[++index], flag)
  }
  return { feed, count, otherArgs }
}

function readOptions(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        count: { type: 'string', short: 'n' },
        filter: { type: 'string', short: 'f' },
        interactive: { type: 'boolean', short: 'i' },
        json: { type: 'boolean' },
        markdown: { type: 'boolean' },
        md: { type: 'boolean' },
        depth: { type: 'string', short: 'd' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    })
  } catch (error) {
    exitWithError(`${(error as Error).message}\nRun "hn-daily --help" for usage.`)
  }
}

type Options = ReturnType<typeof readOptions>['values']

function readVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

const showProgress = (text: string) => {
  if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${color.gray(text)}`)
}

const clearProgress = () => {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K')
}

async function listStories(feed: Feed, count: number, options: Options): Promise<void> {
  const markdown = options.markdown || options.md
  if (options.interactive && (options.json || markdown)) exitWithError('--interactive cannot be combined with --json or --markdown.')
  if (options.interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) exitWithError('--interactive needs a terminal.')

  const filterWords = parseFilter(options.filter)
  const shouldInclude = filterWords.length ? (story: Story) => matchesFilter(story, filterWords) : undefined

  showProgress(`Loading ${FEEDS[feed].title.toLowerCase()}...`)
  const stories = await fetchStories({
    feed,
    count,
    shouldInclude,
    onProgress: shouldInclude ? (checked, total) => showProgress(`Searching ${checked}/${total} stories...`) : undefined,
  })
  clearProgress()

  const title = FEEDS[feed].title
  if (options.interactive) return runInteractive(title, stories)
  if (options.json) process.stdout.write(storiesToJson(stories) + '\n')
  else if (markdown) process.stdout.write(storiesToMarkdown(title, stories))
  else process.stdout.write(renderStoryList(title, stories, terminalWidth()) + '\n')
}

async function showComments(input: string | undefined, options: Options): Promise<void> {
  if (!input) exitWithError('tell me which story, for example: hn-daily comments 41234567')
  const id = parseItemId(input)
  if (!id) exitWithError(`"${input}" is not a Hacker News id or link.`)
  const depth = readNumberOption(options.depth, '--depth') ?? Infinity
  showProgress('Loading comments...')
  const thread = await fetchThread(id, depth)
  clearProgress()
  if (options.json) process.stdout.write(threadToJson(thread) + '\n')
  else if (options.markdown || options.md) process.stdout.write(threadToMarkdown(thread))
  else process.stdout.write('\n' + threadLines(thread, terminalWidth()).join('\n') + '\n')
}

async function main(): Promise<void> {
  const { feed, count: feedCount, otherArgs } = splitFeedFlags(process.argv.slice(2))
  const { values: options, positionals } = readOptions(otherArgs)

  if (options.help) return void process.stdout.write(HELP + '\n')
  if (options.version) return void process.stdout.write(readVersion() + '\n')

  const [command, argument] = positionals
  if (command === 'comments' || command === 'c') return showComments(argument, options)
  if (command !== undefined) exitWithError(`unknown command "${command}". Run "hn-daily --help" for usage.`)

  const count = readNumberOption(options.count, '--count') ?? feedCount ?? 10
  return listStories(feed, count, options)
}

main().catch((error: Error) => {
  clearProgress()
  exitWithError(error.message)
})
