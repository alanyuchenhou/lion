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
  const { contents } = req.body
  if (!contents) {
    return res.status(400).send('contents is required')
  }
  const fileName = process.env.OBJECT_NAME
  await getBucket().file(fileName).save(contents)
  res.send({ fileName: fileName })
})

app.post('/agents', async (req, res) => {
  req.log.info({ logField: 'custom-entry' }) // https://cloud.google.com/run/docs/logging#correlate-logs
  const id = Date.now().toString()
  const { name, systemInstruction } = req.body
  if (!name) {
    return res.status(400).send('name is required')
  }
  if (!systemInstruction) {
    return res.status(400).send('systemInstruction is required')
  }
  saveFile(id, name, systemInstruction)
  res.send({ id })
})

app.get('/agents', async (req, res) => {
  const [files] = await getBucket().getFiles({
    prefix: getAgentsDirectory(),
  })
  const agents = files.map(({ name, metadata }) => ({
    id: name,
    name: metadata.metadata?.name,
    created: metadata.timeCreated,
    updated: metadata.updated,
  }))
  return res.send(agents)
})

app.get('/agents/:id', async (req, res) => {
  const { id } = req.params
  const fileName = getAgentFileName(id)
  try {
    const fileJson = await downloadFile(fileName)
    return res.send(fileJson)
  } catch (error) {
    req.log.error(error)
    return res.status(404).send({ id })
  }
})

app.put('/agents/:id', async (req, res) => {
  const { id } = req.params
  const { name, systemInstruction } = req.body
  saveFile(id, name, systemInstruction)
  res.send({ id })
})

app.delete('/agents/:id', async (req, res) => {
  const { id } = req.params
  const fileName = getAgentFileName(id)
  try {
    await getBucket().file(fileName).delete()
    res.send({ id })
  } catch (error) {
    req.log.error(error)
    return res.status(404).send({ id })
  }
})

app.get('/transcriptions/:callSid', async (req, res) => {
  const { callSid } = req.params
  if (!callSid) {
    return res.status(400).send('callSid is required')
  }
  req.log.info({ callSid })
  const fileName = getTranscriptionFilename(callSid)
  try {
    const messages = await downloadFile(fileName)
    const transcription = messages.filter(
      (message) => message.role !== 'system',
    )
    return res.send(transcription)
  } catch (error) {
    req.log.error(error)
    return res.send([])
  }
})

export default app

async function downloadFile(fileName) {
  const fileContent = await getBucket().file(fileName).download()
  const fileJson = JSON.parse(fileContent.toString())
  return fileJson
}

function saveFile(id, name, systemInstruction) {
  const fileName = getAgentFileName(id)
  getBucket()
    .file(fileName)
    .save(JSON.stringify({ systemInstruction }), {
      metadata: { metadata: { name } },
    })
}

function getAgentFileName(id) {
  return `${getAgentsDirectory()}${id}.json`
}

function getAgentsDirectory() {
  const agentsDirectory = process.env.GCP_STORAGE_AGENTS_PATH
  if (!agentsDirectory) {
    throw new Error('unable to find agents directory')
  }
  return agentsDirectory
}

function getTranscriptionFilename(callSid) {
  const transcriptionsDirectory =
    process.env.GCP_STORAGE_TRANSCRIPTIONS_DIRECTORY
  if (!transcriptionsDirectory) {
    throw new Error('unable to find transcriptions directory')
  }
  return `${transcriptionsDirectory}${callSid}.json`
}
