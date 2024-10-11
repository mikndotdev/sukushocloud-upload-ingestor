import { Elysia } from 'elysia';
import { bearer } from '@elysiajs/bearer';
import crypto from 'node:crypto'
import * as Minio from 'minio'

const minioClient = new Minio.Client({
  endPoint: "fly.storage.tigris.dev",
  port: 443,
  useSSL: true,
  accessKey: process.env.S3_ACCESS_KEY as string || "",
  secretKey: process.env.S3_SECRET_KEY as string || "",
  region: "auto"
})

const app = new Elysia()

app.use(bearer())

app.get('/', () => {
  return Response.redirect('https://sukusho.cloud/', 302)
})

app.post('/upload', async ({ body, bearer }) => {

  if (!bearer) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (!body.file) {
    return new Response('No file provided', { status: 400 })
  }

  const key = bearer.toString()

  const userData = await fetch(`${process.env.BACKEND_API_ENDPOINT}/getInfoFromKey?key=${process.env.BACKEND_SIGNING_KEY}&apiKey=${key}`, {
    method: 'GET',
  })

  if (!userData.ok) {
    return new Response('Unauthorized', { status: 401 })
  }

  const json = await userData.json()

  const file = body.file
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fileIdString = `${crypto.randomBytes(16).toString('hex')}`
  const fileId = `${fileIdString}.${file.name.split('.').pop()}`

  let uploadLimit = 0

  if (json.plan === 'FREE') {
    uploadLimit = 5 * 1024 * 1024
  }
  else if (json.plan === 'ProStd') {
    uploadLimit = 50 * 1024 * 1024
  }
  else if (json.plan === 'ProUlt') {
    uploadLimit = 100 * 1024 * 1024
  }

  if (buffer.length > uploadLimit) {
    return new Response('Filesize exceeds plan limit', { status: 429 })
  }

  const usedStorage = json.usedStorage * 1024 * 1024
  const totalStorage = json.totalStorage * 1024 * 1024

  if (usedStorage + buffer.length > totalStorage) {
    return new Response('Storage limit exceeded', { status: 402 })
  }

  try {

  const upload = await minioClient.putObject('sukushocloud', `${json.id}/${fileId}`, buffer, file.size, {
    'Content-Type': file.type,
    'X-Tigris-Regions': json.preferredRegion
  });

  const rawUrl = `https://sukushocloud.mdusercontent.com/${json.id}/${fileId}`
  const viewUrl = `https://view.sukusho.cloud/i/${fileIdString}`

  const sid = crypto.randomBytes(3).toString('hex')

  await fetch('https://sksh.me/api/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SHORTFLARE_API_KEY}`
    },
    body: JSON.stringify({
      slug: sid,
      destination: viewUrl
    })
  })

  const shortUrl = `https://sksh.me/${sid}`

  await fetch(`${process.env.BACKEND_API_ENDPOINT}/addImage?key=${process.env.BACKEND_SIGNING_KEY}&id=${json.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: rawUrl,
      size: file.size,
      fileId: fileIdString,
      name: fileId,
      shortUrl,
    })
  })

  return new Response(JSON.stringify({
    rawUrl,
    viewUrl,
    shortUrl,
  }), {
    headers: {
      'Content-Type': 'application/json'
    }
  })


  }
  catch (e) {
    console.error(e)
    return new Response('Error uploading file', { status: 500 })
  }
})

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${process.env.PORT || 3000}`)
})
