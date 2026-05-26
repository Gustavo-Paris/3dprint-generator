import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'
import { desc, eq } from 'drizzle-orm'

async function main() {
  const connectionString = "postgres://app:app@localhost:5432/app"
  const client = postgres(connectionString)
  const db = drizzle(client, { schema })

  const list = await db
    .select()
    .from(schema.iterations)
    .where(eq(schema.iterations.projectId, "6e6585ad-d9ba-457b-b3c4-61176d24131d"))
    .orderBy(desc(schema.iterations.createdAt))

  console.log("ITERATIONS FOR PROJECT:")
  for (const it of list) {
    console.log(`ID: ${it.id}`)
    console.log(`  User Message: ${it.userMessage}`)
    console.log(`  Status: ${it.status}`)
    console.log(`  Strategy: ${it.strategy}`)
    console.log(`  Mesh URL: ${it.meshBlobUrl}`)
    console.log(`  Created At: ${it.createdAt}`)
    console.log(`  Error: ${it.error}`)
    console.log(`  Design: ${JSON.stringify(it.validationReport)}`)
    console.log("-----------------------------------------")
  }

  await client.end()
}

main().catch(console.error)
