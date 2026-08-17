/*
Base : https://apkmody.mobi
Author : phrzy
channel : https://whatsapp.com/channel/0029VbD1zGq6mYPUbtVh6U0L/121
Converted to ESM bot plugin format
*/

import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE = 'https://apkmody.mobi'
const HOSTS = ['apkmody.com', 'apkmody.io', 'apkmody.mobi']
const FILE_RE = /\.(apk|obb|zip|rar|7z|xapk)$/i
const SLUG_RE = /\/(games|apps)\/[^/]+/
const SIZE_RE = /([\d.,]+)\s*(TB|GB|MB|KB)/i
const SIZE_MULT = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 }

const headers = {
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua-mobile': '?1',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'referer': 'https://apkmody.mobi/'
}

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  maxRedirects: 5,
  validateStatus: () => true,
  headers
})

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

function finalUrlOf(res) {
  const req = res.request
  return (
    (req && req.res && req.res.responseUrl) ||
    (req && req._redirectable && req._redirectable._currentUrl) ||
    null
  )
}

async function fetchPage(url, { referer } = {}) {
  let res
  try {
    res = await client.get(url, { headers: referer ? { referer } : {} })
  } catch (e) {
    const status = e.response && e.response.status
    throw new Error((status ? 'HTTP ' + status + ' for ' : 'Failed to load ') + url)
  }
  if (res.status >= 400) throw new Error('HTTP ' + res.status + ' for ' + url)
  return { status: res.status, body: res.data, url: finalUrlOf(res) || url }
}

function isApkmodyUrl(url) {
  let host
  try { host = new URL(url).hostname } catch { return false }
  return HOSTS.some((d) => host === d || host.endsWith('.' + d))
}

function normalizeUrl(url) {
  const u = new URL(url)
  return BASE + u.pathname + u.search
}

function parseSize(str) {
  const m = String(str || '').match(SIZE_RE)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, '.'))
  return Math.round(n * (SIZE_MULT[m[2].toLowerCase()] || 1))
}

function packageFromIcon(iconUrl) {
  const m = String(iconUrl || '').match(/\/packages\/([^/]+)\/icon_/)
  return m ? m[1] : null
}

function classifyPage(url) {
  const u = new URL(url)
  const p = u.pathname
  if (u.searchParams.has('s')) return 'search'
  if (/\/(?:games|apps)\/[^/]+\/history\/[A-Za-z0-9]+/.test(p)) return 'version'
  if (/\/history\/?$/.test(p)) return 'history'
  if (/\/download\/?$/.test(p)) return 'download'
  if (/\/(?:games|apps)\/[^/]+/.test(p)) return 'detail'
  return 'other'
}

function parseDetail($) {
  const h1Strong = $('h1 strong').first().text()
  const title = clean(h1Strong) ||
    $('title').first().text().replace(/\s*[-|]\s*APKMODY\s*$/i, '').trim() || ''
  const spanText = $('h1 strong').first().parent().find('span').first().text()
  const version = (spanText.match(/v(\d+(?:\.\d+)+)/) || [])[1] || null
  const mod = (spanText.match(/\(([^()]*?)\)/) || [])[1] || null
  const icon =
    $('img[src^="https://cdn.topmongo.com/packages/"]').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null
  const updated = $('time[datetime]').first().attr('datetime') || null
  return { title, version, mod, icon, package: packageFromIcon(icon), updated }
}

function parseFiles($) {
  const files = []
  const seen = new Set()
  $('a[href^="https://cdn.topmongo.com/packages/"]').each((_, el) => {
    const url = $(el).attr('href') || ''
    if (!FILE_RE.test(url) || seen.has(url)) return
    seen.add(url)
    const text = clean($(el).text())
    const size = (text.match(SIZE_RE) || [])[0] || null
    files.push({
      fileName: url.split('/').pop(),
      size,
      sizeBytes: parseSize(size),
      type: (url.match(FILE_RE) || [])[1] || null,
      url
    })
  })
  return files
}

function parseHistory($) {
  const items = []
  $('.historyItem a[href*="/history/"]').each((_, el) => {
    const version = clean($(el).find('.font18').text())
    const date = clean($(el).find('.top .grayColor').text())
    const name = clean($(el).find('.gameTitle').text())
    const size = clean($(el).find('.bottom .grayColor').text())
    items.push({ version, date, name, size, sizeBytes: parseSize(size), url: BASE + ($(el).attr('href') || '') })
  })
  return items
}

function parseListing($) {
  const items = []
  const seen = new Set()
  $('a.app[href]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(SLUG_RE)
    if (!m) return
    const url = BASE + m[0]
    if (seen.has(url)) return
    seen.add(url)
    const icon = $(el).find('img[src*="topmongo.com/packages/"]').attr('src') || null
    const title = clean($(el).find('.has-normal-font-size').first().text())
    const version = clean($(el).find('.has-small-font-size').first().text())
    items.push({ title, version, icon, package: packageFromIcon(icon), url })
  })
  return items
}

function parseSearchItems($) {
  const items = []
  const seen = new Set()
  $('article.card a[href]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(SLUG_RE)
    if (!m) return
    const url = BASE + m[0]
    if (seen.has(url)) return
    seen.add(url)
    const cover = $(el).find('img').first().attr('src') || null
    const title = clean($(el).find('.card-title .truncate').first().text())
    const version = clean($(el).find('.card-excerpt').first().text())
    items.push({ title, version, cover, url })
  })
  return items
}

const basePath = (isApp, slug) => BASE + '/' + (isApp ? 'apps' : 'games') + '/' + slug

async function detail(url, { history = true } = {}) {
  const type = classifyPage(url)
  const page = await fetchPage(url)

  if (['detail', 'version', 'history', 'download'].includes(type)) {
    if (new URL(page.url).pathname === '/') {
      throw new Error('Page not found: ' + url + ' (redirected to homepage)')
    }
  }

  const $ = cheerio.load(page.body)

  if (type === 'search') {
    const items = parseSearchItems($)
    return { type: 'search', query: new URL(url).searchParams.get('s'), source: url, count: items.length, items }
  }

  if (type === 'other') {
    const items = parseListing($)
    if (items.length) return { type: 'listing', source: url, count: items.length, items }
    throw new Error('Unrecognized page / not a game, app, or listing page')
  }

  const isApp = /\/apps\//.test(url)
  const kind = isApp ? 'app' : 'game'
  const slug = (url.match(/\/(?:games|apps)\/([^/]+)/) || [])[1] || null
  const parsed = parseDetail($)

  if (type === 'version') {
    return {
      type: kind,
      title: parsed.title,
      version: parsed.version,
      mod: parsed.mod,
      icon: parsed.icon,
      package: parsed.package,
      updated: parsed.updated,
      source: url,
      downloads: parseFiles($),
      history: history ? parseHistory($) : []
    }
  }

  if (type === 'history' || type === 'download') {
    let files = parseFiles($)
    let page2 = page
    if (!files.length && type === 'download') {
      page2 = await fetchPage(basePath(isApp, slug) + '/history')
      files = parseFiles(cheerio.load(page2.body))
    }
    const hist = history ? parseHistory(cheerio.load(page2.body)) : []
    const hasH1 = $('h1 strong').length > 0
    return {
      type: kind,
      title: hasH1 ? parsed.title : hist.length ? hist[0].name : parsed.title,
      version: parsed.version || (hist.length ? hist[0].version.replace(/^Ver\s*/i, '') : null),
      mod: parsed.mod,
      icon: parsed.icon,
      package: parsed.package,
      updated: parsed.updated,
      source: type === 'history' ? url : normalizeUrl(page2.url),
      downloads: files,
      history: hist
    }
  }

  let files = []
  let hist = []
  try {
    const histPage = await fetchPage(basePath(isApp, slug) + '/history')
    const $h = cheerio.load(histPage.body)
    files = parseFiles($h)
    if (history) hist = parseHistory($h)
  } catch {
    files = []
  }
  if (!files.length) {
    const dlPage = await fetchPage(basePath(isApp, slug) + '/download')
    files = parseFiles(cheerio.load(dlPage.body))
  }
  return {
    type: kind,
    title: parsed.title,
    version: parsed.version,
    mod: parsed.mod,
    icon: parsed.icon,
    package: parsed.package,
    updated: parsed.updated,
    source: url,
    downloads: files,
    history: hist
  }
}

async function search(query, { page } = {}) {
  const q = String(query || '').trim()
  if (!q) throw new Error('Empty search query')
  const u = new URL(BASE + '/')
  u.searchParams.set('s', q)
  if (page && page > 1) u.searchParams.set('page', String(page))
  const url = u.toString()
  const res = await fetchPage(url)
  const items = parseSearchItems(cheerio.load(res.body))
  return { type: 'search', query: q, source: url, count: items.length, page: page || 1, items }
}

// ---------------------------------------------------------------------
// Bot handler
// ---------------------------------------------------------------------

const GUIDE = `📦 *APKMODY Downloader*

Search, inspect, and grab download links for modded APKs and games from apkmody.mobi.

*Usage:*
> \`.apkmody search <query>\` — search for a game/app
> \`.apkmody <url>\` — get details + download links for a game/app page
> \`.apkmody\` (reply to a result with its number) — pick a result from a search

*Examples:*
> \`.apkmody search gta sa\`
> \`.apkmody https://apkmody.mobi/games/gta-sa\`

Only official apkmody.mobi/.com/.io links are supported.`

function fmtSize(bytes) {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return n.toFixed(1) + ' ' + u[i]
}

function fmtDetail(d) {
  let txt = `🎮 *${d.title || 'Unknown'}*\n`
  if (d.version) txt += `📌 Version: ${d.version}\n`
  if (d.mod) txt += `🛠️ Mod: ${d.mod}\n`
  if (d.updated) txt += `🕒 Updated: ${d.updated}\n`
  txt += `🔗 Source: ${d.source}\n\n`
  if (d.downloads && d.downloads.length) {
    txt += `*Download links:*\n`
    for (const f of d.downloads) {
      txt += `• ${f.fileName} (${f.size || fmtSize(f.sizeBytes) || '?'})\n${f.url}\n`
    }
  } else {
    txt += `⚠️ No download links found on this page.`
  }
  return txt.trim()
}

function fmtSearch(res) {
  if (!res.items.length) return `🔍 No results found for "${res.query}".`
  let txt = `🔍 *Search results for "${res.query}"* (${res.count})\n\n`
  res.items.forEach((it, i) => {
    txt += `${i + 1}. *${it.title || 'Untitled'}*${it.version ? ' — ' + it.version : ''}\n${it.url}\n\n`
  })
  txt += `Reply with \`.apkmody <url>\` on any link above to get download links.`
  return txt.trim()
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const input = (text || '').trim()

  if (!input) {
    return conn.reply(m.chat, GUIDE, m)
  }

  try {
    await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } })

    let result
    if (/^search\s+/i.test(input)) {
      const query = input.replace(/^search\s+/i, '').trim()
      if (!query) throw new Error(`Provide a search term.\nExample: *${usedPrefix + command} search gta sa*`)
      result = await search(query)
      await conn.reply(m.chat, fmtSearch(result), m)
    } else if (/^https?:\/\//i.test(input)) {
      if (!isApkmodyUrl(input)) {
        throw new Error('Only apkmody.mobi / apkmody.com / apkmody.io links are supported.')
      }
      result = await detail(input)
      if (result.type === 'search') {
        await conn.reply(m.chat, fmtSearch(result), m)
      } else if (result.type === 'listing') {
        await conn.reply(m.chat, fmtSearch({ query: 'listing', count: result.count, items: result.items }), m)
      } else {
        await conn.reply(m.chat, fmtDetail(result), m)
      }
    } else {
      // treat bare text as a search query for convenience
      result = await search(input)
      await conn.reply(m.chat, fmtSearch(result), m)
    }

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
  } catch (e) {
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    await conn.reply(m.chat, `❌ ${e.message || 'Something went wrong.'}`, m)
  }
}

handler.help = ['apkmody']
handler.command = ['apkmody']
handler.tags = ['downloader']
handler.limit = false

export default handler
