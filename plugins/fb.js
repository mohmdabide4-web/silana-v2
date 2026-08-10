/*
# Feature : Facebook Video Downloader
# Type : ESM Plugin
# Source API : https://fget.io
*/
import axios from 'axios'
import * as cheerio from 'cheerio'

const fget = async (url) => {
  const endpoint = 'https://fget.io/process'

  const body = new URLSearchParams({
    id: url,
    locale: 'id'
  })

  const { data: html } = await axios.post(endpoint, body.toString(), {
    headers: {
      'HX-Request': 'true',
      'HX-Trigger': 'form',
      'HX-Target': 'target',
      'HX-Current-URL': 'https://fget.io/id',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'Origin': 'https://fget.io',
      'Referer': 'https://fget.io/id'
    },
    timeout: 30000
  })

  const $ = cheerio.load(html)

  const result = {
    status: true,
    title: $('.result-title').first().text().trim() || null,
    thumbnail: $('.result-thumbnail img').attr('src') || null,
    video: [],
    audio: null
  }

  $('a.download-result').each((_, el) => {
    const a = $(el)
    const href = a.attr('href')
    const download = a.attr('download')

    if (!href) return

    const quality = a
      .closest('div.flex.items-center')
      .find('.text-sm')
      .first()
      .text()
      .trim()

    const type = a.hasClass('hd')
      ? 'hd'
      : a.hasClass('sd')
        ? 'sd'
        : a.hasClass('mp3')
          ? 'mp3'
          : 'unknown'

    const item = { type, quality: quality || null, url: href, filename: download || null }

    if (type === 'mp3') {
      result.audio = item
    } else {
      result.video.push(item)
    }
  })

  return result
}

const isFbUrl = (str = '') => /facebook\.com|fb\.watch/i.test(str)

let handler = async (m, { conn, text, usedPrefix, command }) => {
  // No link provided -> show a guide card
  if (!text || !isFbUrl(text)) {
    const guide = `
📥 *Facebook Video Downloader*

This feature downloads a video from a public Facebook post, reel, or share link, and sends it back to you here in chat — no need to open Facebook or use a third-party website.

*How to use:*
1. Open Facebook and copy the link of the video/reel you want (Share > Copy Link).
2. Send:
   \`${usedPrefix + command} <facebook_link>\`

*Example:*
${usedPrefix + command} https://www.facebook.com/share/r/184NbDt7Lw/

⚠️ Note: the video/post must be public. Private or friends-only content can't be fetched.
`.trim()

    return conn.reply(m.chat, guide, m)
  }

  try {
    await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } })

    const result = await fget(text.trim())

    if (!result.status || (!result.video.length && !result.audio)) {
      throw new Error('No downloadable media found for this link.')
    }

    // Prefer the highest quality video (hd > sd), fall back to audio only
    const best =
      result.video.find((v) => v.type === 'hd') ||
      result.video.find((v) => v.type === 'sd') ||
      result.video[0]

    const caption = result.title ? `🎬 *${result.title}*` : '🎬 Here is your video'

    if (best) {
      await conn.sendMessage(
        m.chat,
        {
          video: { url: best.url },
          caption,
          mimetype: 'video/mp4'
        },
        { quoted: m }
      )
    }

    // Also send the audio-only version if it exists and the user might want it
    if (result.audio) {
      await conn.sendMessage(
        m.chat,
        {
          audio: { url: result.audio.url },
          mimetype: 'audio/mpeg'
        },
        { quoted: m }
      )
    }

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
  } catch (err) {
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    conn.reply(m.chat, `❌ Failed to download: ${err.message}`, m)
  }
}

handler.help = ['fb']
handler.command = ['fb']
handler.tags = ['downloader']
handler.limit = false
export default handler
