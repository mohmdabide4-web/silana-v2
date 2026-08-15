/*
name: TinyPNG Compressor
base url: https://tinypng.com

author: xvlovers
github: xvlovers

fungsi: upload gambar ke tinypng untuk kompresi otomatis.

credit: xvlovers
*/

import axios from "axios"

const BASE_URL = "https://tinypng.com"
const UPLOAD_URL = "https://tinypng.com/backend/opt/shrink"
const VALID_MIME = ["image/png", "image/jpeg", "image/webp"]
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

async function uploadImage(buffer) {
  if (buffer.length > MAX_SIZE) {
    throw new Error("File terlalu besar. Maksimal 5MB")
  }

  const response = await axios.post(UPLOAD_URL, buffer, {
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/octet-stream",
      "Origin": BASE_URL,
      "Referer": BASE_URL + "/",
      "Cache-Control": "no-cache"
    },
    maxRedirects: 5,
    validateStatus: status => status < 500
  })

  if (response.data?.error) {
    throw new Error(response.data.message || response.data.error)
  }

  if (!response.data?.output?.url) {
    throw new Error("Kompresi gagal, coba lagi nanti")
  }

  return {
    originalSize: response.data.input?.size || buffer.length,
    compressedSize: response.data.output?.size || null,
    ratio: response.data.output?.ratio || null,
    url: response.data.output?.url,
    width: response.data.output?.width || null,
    height: response.data.output?.height || null
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB"]
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(2)} ${units[i]}`
}

let handler = async (m, { conn }) => {
  const quoted = m.quoted ? m.quoted : m
  const mime = (quoted.msg || quoted).mimetype || ""

  if (!mime || !VALID_MIME.some(v => mime.includes(v.split("/")[1]))) {
    return conn.reply(
      m.chat,
      "📌 *TinyPNG Compressor*\n\n" +
      "Compress an image (PNG, JPG, or WEBP) using TinyPNG's smart lossy compression — great for shrinking file sizes before sending or uploading.\n\n" +
      "*How to use:*\n" +
      "1. Send or reply to an image with the command *" + (handler.command?.[0] || "tinypng") + "*\n" +
      "2. Wait a moment while the bot uploads and compresses it\n" +
      "3. You'll get the compressed image back, plus the size reduction stats\n\n" +
      "⚠️ Max file size: 5MB. Supported formats: png, jpg, jpeg, webp.",
      m
    )
  }

  try {
    await m.react("⏳")

    const buffer = await quoted.download()
    const result = await uploadImage(buffer)
    const compressedBuffer = (await axios.get(result.url, { responseType: "arraybuffer" })).data

    const caption =
      `✅ *Compression complete*\n\n` +
      `• Original size: ${formatBytes(result.originalSize)}\n` +
      `• Compressed size: ${formatBytes(result.compressedSize)}\n` +
      `• Saved: ${result.ratio ? (result.ratio * 100).toFixed(1) + "%" : "N/A"}`

    await conn.sendFile(m.chat, compressedBuffer, "compressed.jpg", caption, m)
    await m.react("✅")
  } catch (error) {
    await m.react("❌")
    await conn.reply(m.chat, `❌ Compression failed: ${error.message}`, m)
  }
}

handler.help = handler.command = ['compress-img']
handler.tags = ['editor']
handler.limit = false
export default handler
