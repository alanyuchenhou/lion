import express from 'express'
import { pinoHttp } from './utils/logging.js'
import { Storage } from '@google-cloud/storage'
import dotenv from 'dotenv'
dotenv.config()

const JSON_EXTENSION = '.json'
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

app.post('/agents', async (req, res) => {
  req.log.info({ logField: 'custom-entry' }) // https://cloud.google.com/run/docs/logging#correlate-logs
  const id = Date.now().toString()
  const { name } = req.body
  if (!name) {
    return res.status(400).send('name is required')
  }
  saveFile(id, name, { systemInstruction: '' })
  res.send({ id, name })
})

app.get('/agents', async (req, res) => {
  const agentsPath = getAgentsPath()
  const [files] = await getBucket().getFiles({
    prefix: agentsPath,
  })
  const agents = files.map(({ name, metadata }) => {
    const id =
      name.startsWith(agentsPath) && name.endsWith(JSON_EXTENSION)
        ? name.slice(agentsPath.length, -JSON_EXTENSION.length)
        : name
    return {
      id,
      name: metadata.metadata?.name,
      created: metadata.timeCreated,
      updated: metadata.updated,
    }
  })
  return res.send(agents)
})

app.get('/agents/:id', async (req, res) => {
  const { id } = req.params
  const fileName = getAgentFileName(id)
  try {
    const fileJson = await downloadFile(fileName)
    const agentName = await getAgentName(fileName)
    return res.send({ name: agentName, details: fileJson })
  } catch (error) {
    req.log.error(error)
    return res.status(404).send({ id })
  }
})

app.put('/agents/:id', async (req, res) => {
  const { id } = req.params
  const { name, details } = req.body
  saveFile(id, name, details)
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
async function getAgentName(fileName) {
  const [metadata] = await getBucket().file(fileName).getMetadata()
  return metadata.metadata.name
}

function saveFile(id, name, details) {
  const fileName = getAgentFileName(id)
  getBucket()
    .file(fileName)
    .save(JSON.stringify(details), {
      metadata: { metadata: { name } },
    })
}

function getAgentFileName(id) {
  return `${getAgentsPath()}${id}${JSON_EXTENSION}`
}

function getAgentsPath() {
  const agentsPath = process.env.GCP_STORAGE_AGENTS_PATH
  if (!agentsPath) {
    throw new Error('unable to find agents path')
  }
  return agentsPath
}

function getTranscriptionFilename(callSid) {
  const transcriptionsPath = process.env.GCP_STORAGE_TRANSCRIPTIONS_DIRECTORY
  if (!transcriptionsPath) {
    throw new Error('unable to find transcriptions directory')
  }
  return `${transcriptionsPath}${callSid}${JSON_EXTENSION}`
}
