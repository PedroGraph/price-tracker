/** Telegram only accepts a few tags: keep b/i/code/a, turn paragraphs into line breaks. */
export function toTelegramHtml(html: string): string {
  return html
    .replace(/<\/p>\s*/g, '\n')
    .replace(/<(?!\/?(b|i|code|a)\b)[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}
