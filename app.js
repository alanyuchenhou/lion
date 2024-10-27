import express from 'express'
import { pinoHttp } from './utils/logging.js'
import { Storage } from '@google-cloud/storage'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
// Middleware to parse JSON request bodies
app.use(express.json())

// Use request-based logger for log correlation
app.use(pinoHttp)

function getBucket() {
  const storage = new Storage()
  const bucketName = process.env.BUCKET_NAME
  if (!bucketName) {
    throw new Error('unable to find bucket name')
  }
  return storage.bucket(bucketName)
}

app.put('/', async (req, res) => {
  req.log.info({ logField: 'custom-entry' }) // https://cloud.google.com/run/docs/logging#correlate-logs
  const { contents } = req.body
  if (!contents) {
    return res.status(400).send('contents is required')
  }
  const fileName = process.env.OBJECT_NAME
  await getBucket().file(fileName).save(contents)
  res.send({ fileName: fileName })
})

app.get('/transcription/:callSid', async (req, res) => {
  const { callSid } = req.params
  if (!callSid) {
    return res.status(400).send('callSid is required')
  }
  req.log.info({ callSid })
  const transcriptionsDirectory =
    process.env.GCP_STORAGE_TRANSCRIPTIONS_DIRECTORY
  if (!transcriptionsDirectory) {
    return res.status(500).send('unable to find transcription directory')
  }
  const fileName = `${transcriptionsDirectory}${callSid}.json`
  const fileContent = await getBucket().file(fileName).download()
  const transcription = JSON.parse(fileContent.toString()).filter(
    (message) => message.role !== 'system',
  )
  res.send(transcription)
})

export default app
