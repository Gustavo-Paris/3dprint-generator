import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'
import { desc } from 'drizzle-orm'

async function main() {
  const connectionString = "postgres://app:app@localhost:5432/app"
  const client = postgres(connectionString)
  const db = drizzle(client, { schema })

  const [latest] = await db
    .select()
    .from(schema.iterations)
    .orderBy(desc(schema.iterations.createdAt))
    .limit(1)

  console.log("LATEST ITERATION:")
  console.log("ID:", latest?.id)
  console.log("Status:", latest?.status)
  console.log("Error:", latest?.error)
  console.log("User Message:", latest?.userMessage)
  console.log("Image URL:", latest?.imageBlobUrl)
  console.log("Mesh URL:", latest?.meshBlobUrl)
  console.log("Strategy:", latest?.strategy)
  console.log("Design:")
  console.log(JSON.stringify(latest?.validationReport, null, 2))

  await client.end()
}

main().catch(console.error)
