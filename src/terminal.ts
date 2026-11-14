const isTTY = Boolean(process.stdout.isTTY)
const forceColor = process.env.FORCE_COLOR
const useColor = forceColor !== undefined ? forceColor !== '0' : isTTY && !('NO_COLOR' in process.env)

const style =
  (open: string, close: string) =>
  (text: string | number): string =>
    useColor ? `\x1b[${open}m${text}\x1b[${close}m` : String(text)

export const color = {
  bold: style('1', '22'),
  red: style('31', '39'),
  cyan: style('36', '39'),
  gray: style('90', '39'),
  white: style('97', '39'),
  orange: style('38;5;208', '39'),
  badge: style('48;5;208;97;1', '49;39;22'),
}

export const screen = {
  enter(): void {
    if (isTTY) process.stdout.write('\x1b[?1049h\x1b[?25l')
  },
  leave(): void {
    if (isTTY) process.stdout.write('\x1b[?25h\x1b[?1049l')
  },
  draw(lines: string[]): void {
    if (isTTY) process.stdout.write('\x1b[H' + lines.map((line) => line + '\x1b[K').join('\n') + '\x1b[J')
  },
}

export const terminalWidth = (): number => Math.max(40, Math.min(process.stdout.columns || 100, 140))

export const terminalHeight = (): number => Math.max(12, process.stdout.rows || 30)

export const visibleLength = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, '').length

export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length > width ? text.slice(0, Math.max(0, width - 1)).trimEnd() + '…' : text
}

export function wrap(text: string, width: number): string[] {
  const lineWidth = Math.max(10, width)
  const lines: string[] = []
  let line = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > lineWidth) {
      if (line) lines.push(line)
      lines.push(word.slice(0, lineWidth))
      word = word.slice(lineWidth)
      line = ''
    }
    if (!word) continue
    if (!line) line = word
    else if (line.length + 1 + word.length <= lineWidth) line += ' ' + word
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}
