import express from 'express'
import { pinoHttp, logger } from './utils/logging.js'
import { Storage } from '@google-cloud/storage'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
// Middleware to parse JSON request bodies
app.use(express.json())

// Use request-based logger for log correlation
app.use(pinoHttp)

// Example endpoint
app.post('/', async (req, res) => {
  // Use basic logger without HTTP request info
  logger.info({ logField: 'custom-entry', arbitraryField: 'custom-entry' }) // Example of structured logging
  // Use request-based logger with log correlation
  req.log.info('Child logger with trace Id.') // https://cloud.google.com/run/docs/logging#correlate-logs
  const { contents } = req.body

  if (!contents) {
    return res.status(400).send('contents is required')
  }
  const storage = new Storage()
  await storage
    .bucket(process.env.BUCKET_NAME || '')
    .file(process.env.OBJECT_NAME || '')
    .save(contents)
  res.send('contents saved')
})

export default app
