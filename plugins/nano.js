/**
 * 🍌 Nano-Banana AI Multi-Engine
 * Author: Omegatech
 * Version: 5.0 (Collector Mode)
 * Description: Advanced AI image generation and editing with multi-image blending
 *
 * 🛠️ Features:
 * - Text to image generation
 * - Image editing with prompts
 * - Multi-image blending (up to 4 images)
 * - Collector mode for batch processing
 */

import axios from 'axios'
import FormData from 'form-data'

let bananaSession = {}

async function uploadMedia(m) {
  try {
    const q = m.quoted ? m.quoted : m
    if (!/image/.test(q.mimetype || q.msg?.mimetype)) return null
    const media = await q.download()
    const form = new FormData()
    form.append('file', media, { filename: 'image.jpg' })
    form.append('type', 'permanent')
    const res = await axios.post('https://tmp.malvryx.dev/upload', form, {
      headers: form.getHeaders()
    })
    return res.data?.cdnUrl || res.data?.directUrl || null
  } catch (e) {
    return null
  }
}

function showGuide(m, conn, usedPrefix, command) {
  return conn.reply(
    m.chat,
    `📌 *Nano-Banana AI*\n\n` +
    `AI image generation and editing, with support for blending up to 4 images together.\n\n` +
    `*How to use:*\n` +
    `• *${usedPrefix}nano <prompt>* — generate an image from text\n` +
    `• Reply to an image with *${usedPrefix}nano <prompt>* — edit that image\n` +
    `• *${usedPrefix}nanopro* — start collector mode, then send/reply images one by one to add them (up to 4)\n` +
    `• *${usedPrefix}nanopro done <prompt>* — blend all collected images using your prompt\n\n` +
    `⚠️ Limit: 5 uses per user.`,
    m
  )
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const userId = m.sender
  text = text || m.quoted?.text || m.msg?.caption || ''
  const isNanoPro = /nanopro/i.test(command)

  if (isNanoPro) {
    if (!bananaSession[userId]) bananaSession[userId] = { images: [] }

    if (text?.toLowerCase().startsWith('done')) {
      const session = bananaSession[userId]
      const finalPrompt = text.replace(/done/i, '').trim()

      if (session.images.length < 2) {
        return conn.reply(m.chat, '⚠️ *Nano-Banana Pro*\n\nPlease add at least 2 images before finishing.', m)
      }
      if (!finalPrompt) {
        return conn.reply(m.chat, `⚠️ *Prompt Required*\n\nUsage: ${usedPrefix + command} done <your prompt>`, m)
      }

      await m.react('🕒')
      try {
        let apiUrl = `https://omegatech-api.dixonomega.tech/api/ai/nanobana-pro-v3?prompt=${encodeURIComponent(finalPrompt)}`
        session.images.forEach((url, i) => {
          apiUrl += `&image${i + 1}=${encodeURIComponent(url)}`
        })

        const { data: initRes } = await axios.get(apiUrl)
        if (!initRes.success) throw new Error('API failed to initiate blend.')

        const taskId = initRes.task_id
        let resultUrl = null
        let attempts = 0

        while (!resultUrl && attempts < 25) {
          await new Promise(r => setTimeout(r, 5000))
          const { data: check } = await axios.get(`https://omegatech-api.dixonomega.tech/api/ai/nano-banana2-result?task_id=${taskId}`)
          if (check.status === 'completed' && check.image_url) {
            resultUrl = check.image_url
            break
          }
          if (check.status === 'failed') throw new Error('Server reported generation failure.')
          attempts++
        }

        if (!resultUrl) throw new Error('Generation timed out.')

        await conn.sendMessage(m.chat, {
          image: { url: resultUrl },
          caption: `🍌 *NANO-BANANA PRO SUCCESS*\n\n🖼️ *Images Blended:* ${session.images.length}\n📝 *Prompt:* ${finalPrompt}\n🚀 *Source:* Omegatech API`
        }, { quoted: m })

        await m.react('✅')
        delete bananaSession[userId]
      } catch (e) {
        await m.react('❌')
        conn.reply(m.chat, `❌ *Error:* ${e.message}`, m)
        delete bananaSession[userId]
      }
      return
    }

    const link = await uploadMedia(m)
    if (!link) {
      return showGuide(m, conn, usedPrefix, command)
    }

    if (bananaSession[userId].images.length >= 4) {
      return conn.reply(m.chat, '❌ *Limit Reached*\n\nMaximum of 4 images allowed.', m)
    }

    bananaSession[userId].images.push(link)
    await m.react('📥')
    return conn.reply(m.chat, `✅ *Image ${bananaSession[userId].images.length}/4 Added*\n\nSend another image or type:\n*${usedPrefix + command} done <prompt>*`, m)
  }

  if (command === 'nano') {
    if (!text && !m.quoted) {
      return showGuide(m, conn, usedPrefix, command)
    }

    const imageUrl = await uploadMedia(m)

    if (imageUrl) {
      if (!text) {
        return conn.reply(m.chat, `⚠️ *Instruction Required*\n\nExample: Reply to an image with ${usedPrefix}nano make it a zombie`, m)
      }

      await m.react('🎨')
      try {
        const { data: init } = await axios.get(`https://omegatech-api.dixonomega.tech/api/ai/nano-banana2?prompt=${encodeURIComponent(text)}&image=${encodeURIComponent(imageUrl)}`)

        let resultUrl = null
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 5000))
          const { data: check } = await axios.get(`https://omegatech-api.dixonomega.tech/api/ai/nano-banana2-result?task_id=${init.task_id}`)
          if (check.status === 'completed') {
            resultUrl = check.image_url
            break
          }
        }

        if (resultUrl) {
          await conn.sendMessage(m.chat, {
            image: { url: resultUrl },
            caption: `✨ *NANO EDIT SUCCESS*\n\n📝 *Prompt:* ${text}`
          }, { quoted: m })
          await m.react('✅')
        } else {
          await m.react('❌')
          conn.reply(m.chat, '❌ Image edit timed out.', m)
        }
      } catch (e) {
        await m.react('❌')
        conn.reply(m.chat, '❌ Image edit failed.', m)
      }
    } else {
      await m.react('⏳')
      try {
        const { data } = await axios.get(`https://omegatech-api.dixonomega.tech/api/ai/nano-banana-pro?prompt=${encodeURIComponent(text)}`)
        if (data.image) {
          await conn.sendMessage(m.chat, {
            image: { url: data.image },
            caption: `🍌 *NANO PRO GENERATION*\n\n📝 *Prompt:* ${text}`
          }, { quoted: m })
          await m.react('✅')
        } else {
          await m.react('❌')
          conn.reply(m.chat, '❌ No image generated.', m)
        }
      } catch (e) {
        await m.react('❌')
        conn.reply(m.chat, '❌ Generation failed.', m)
      }
    }
  }
}

handler.help = handler.command = ['nano', 'nanopro']
handler.tags = ['editor']
handler.limit = false

export default handler
