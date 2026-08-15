import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'

const BASE_URL = 'https://prithivmlmods-qwen-image-edit-2509-loras-fast.hf.space/gradio_api'
const API_NAME = 'edit_image'
const WORKER_URL = process.env.QWEN_WORKER_URL || 'http://workers.proxy-1.ryuu-dev.my.id'

// Hugging Face token (larger ZeroGPU quota when set).
// Can also be provided via env HF_TOKEN or global.hfkey in settings.js.
const hfToken = process.env.HF_TOKEN || global.hfkey || global.hftoken || `hf_cari-sendiri-jinh`

const errorMessage = (err) => {
  const data = err?.response?.data

  if (typeof data === 'string' && data) {
    return data.slice(0, 300)
  }

  return data?.message || data?.error || err?.message || 'Unknown error'
}

class QwenImageEdit {
  constructor(useToken = true) {
    this.useToken = useToken

    this.axios = axios.create({
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://prithivmlmods-qwen-image-edit-2509-loras-fast.hf.space',
        'Referer': 'https://prithivmlmods-qwen-image-edit-2509-loras-fast.hf.space/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      }
    })
  }

  async workerRequest(method, target, data = null, extra = {}) {
    const res = await this.axios({
      method,
      url: WORKER_URL,
      params: { url: target },
      data,
      headers: this.useToken && hfToken ? {
        'Authorization': `Bearer ${hfToken}`
      } : {},
      ...extra
    })
    return res
  }

  async imageToBase64(input) {
    if (/^https?:\/\//i.test(input)) {
      const res = await this.workerRequest('GET', input, null, {
        responseType: 'arraybuffer',
        timeout: 60000
      })

      return `data:image/jpeg;base64,${Buffer.from(res.data).toString('base64')}`
    }

    const buffer = fs.readFileSync(input)

    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  }

  // Parse the SSE result (full buffered text from the worker proxy) until the completion event
  parseSse(text) {
    let output = null

    for (const line of text.split('\n')) {
      const trimmed = line.trim()

      if (!trimmed.startsWith('data:')) continue

      const raw = trimmed.slice(5).trim()

      if (!raw || raw === '[DONE]') continue

      let evt
      try {
        evt = JSON.parse(raw)
      } catch {
        continue
      }

      if (!evt) continue

      // Array payload = final result (the "complete" event)
      if (Array.isArray(evt)) {
        output = evt
        break
      }

      if (evt.msg === 'process_completed') {
        output = evt.output?.data || null
        break
      }

      if (evt.msg === 'error' || evt.error) {
        throw new Error(evt.error || evt.msg || 'Error from server')
      }
    }

    return output
  }

  extractImage(output) {
    if (!Array.isArray(output) || output.length === 0) {
      throw new Error('Invalid response structure')
    }

    const first = output[0]

    if (first && typeof first === 'object' && first.image) {
      return first.image
    }

    if (first && typeof first === 'object' && first.url) {
      return first.url
    }

    if (typeof first === 'string') {
      return first
    }

    throw new Error('Invalid response structure')
  }

  async editImage({ imageSource, prompt, lora = 'Photo-to-Anime' }) {
    const imageBase64 = await this.imageToBase64(imageSource)

    // Start the job via the official Gradio REST API through the worker proxy
    const start = await this.workerRequest('POST', `${BASE_URL}/call/${API_NAME}`, {
      data: [
        imageBase64,
        prompt,
        lora,
        0,
        true,
        1,
        4
      ]
    })

    const eventId = start.data?.event_id

    if (!eventId) {
      throw new Error('Server did not return an event_id')
    }

    // Fetch the result via SSE stream (worker returns the full buffer once complete)
    const res = await this.workerRequest(
      'GET',
      `${BASE_URL}/call/${API_NAME}/${eventId}`,
      null,
      {
        timeout: 120000,
        responseType: 'text'
      }
    )

    const output = this.parseSse(res.data)

    return this.extractImage(output)
  }
}

function showGuide(m, conn, usedPrefix, command) {
  return conn.reply(
    m.chat,
    `📌 *AI Image Edit (Qwen)*\n\n` +
    `Edits an image using an AI model, with optional LoRA styles (e.g. turning a photo into anime).\n\n` +
    `*How to use:*\n` +
    `• Reply to an image with *${usedPrefix + command} <prompt>*\n` +
    `• Optional: choose token mode with *on/off* before the prompt, separated by \`|\`\n` +
    `  e.g. *${usedPrefix + command} on|make it anime style*\n` +
    `• Optional: add a LoRA style as a third part\n` +
    `  e.g. *${usedPrefix + command} on|make it anime style|Photo-to-Anime*\n\n` +
    `⚠️ Requires an attached or replied-to image. Premium feature.`,
    m
  )
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const q = m.quoted || m
  const mime = (q.msg || q).mimetype || ''

  if (!/image/i.test(mime)) {
    return showGuide(m, conn, usedPrefix, command)
  }

  if (!text) {
    return showGuide(m, conn, usedPrefix, command)
  }

  const args = text.split('|').map(v => v.trim())

  // "off" = without HF token (anonymous quota), anything else uses the token
  const useToken = args[0]?.toLowerCase() !== 'off'

  const promptText = args.length > 1 ? args[1] : args[0]

  if (!promptText || promptText.length < 3) {
    return showGuide(m, conn, usedPrefix, command)
  }

  const loraName = args.length > 2 ? args[2] : 'Photo-to-Anime'

  await m.react('⏳')

  let imgPath = null
  let result = null
  let lastError = null

  try {
    const buffer = await q.download()
    imgPath = path.join(os.tmpdir(), `qwen_${Date.now()}.jpg`)
    fs.writeFileSync(imgPath, buffer)

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const ai = new QwenImageEdit(useToken)

        result = await ai.editImage({
          imageSource: imgPath,
          prompt: promptText,
          lora: loraName
        })

        if (result) break
      } catch (err) {
        lastError = new Error(errorMessage(err))
        console.error(`[Attempt ${attempt}] ${errorMessage(err)}`)

        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }
    }

    if (!result) {
      throw lastError || new Error('Unknown error')
    }

    const caption = `✅ *Done*\n\n*Prompt:* ${promptText}\n*LoRA:* ${loraName}\n*HF Token:* ${useToken ? 'On' : 'Off'}`

    if (result.startsWith('data:image')) {
      const base64 = result.replace(/^data:image\/\w+;base64,/, '')
      const outBuffer = Buffer.from(base64, 'base64')

      await conn.sendMessage(m.chat, { image: outBuffer, caption }, { quoted: m })
    } else {
      await conn.sendMessage(m.chat, { image: { url: result }, caption }, { quoted: m })
    }

    await m.react('✅')
  } catch (err) {
    await conn.reply(m.chat, `❌ Failed after 3 attempts.\nError: ${errorMessage(err)}`, m)
    await m.react('❌')
  } finally {
    if (imgPath && fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath)
    }
  }
}

handler.help = handler.command = ['imgedit']
handler.tags = ['editor']
handler.limit = false
export default handler
