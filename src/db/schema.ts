import { pgTable, text, timestamp, uuid, jsonb, primaryKey, integer, index, check, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { iterationStrategies } from './strategy'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/** Singleton (id = 1) instance configuration — bring-your-own API keys for
 *  self-hosters. Secret columns hold AES-256-GCM ciphertext (lib/crypto/secret.ts),
 *  never plaintext. Env vars act as the fallback when a column is null. */
export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  aiBaseUrl: text('ai_base_url'),
  aiModel: text('ai_model'),
  aiClassifierModel: text('ai_classifier_model'),
  aiApiKeyEnc: text('ai_api_key_enc'),
  meshyApiKeyEnc: text('meshy_api_key_enc'),
  slicerUrl: text('slicer_url'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }),
)

export const sessions = pgTable('sessions', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
)

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // FK to iterations.id, ON DELETE SET NULL. Declared as a lazy column-level
  // reference with an explicit AnyPgColumn return type: projects and iterations
  // reference each other, and that mutual reference otherwise makes TypeScript
  // infer both table types as `any` (circular). The annotation breaks the type
  // cycle; the thunk keeps it lazy so declaration order is irrelevant. Drizzle
  // names the constraint `projects_current_iteration_id_iterations_id_fk`.
  currentIterationId: uuid('current_iteration_id').references(
    (): AnyPgColumn => iterations.id,
    { onDelete: 'set null' },
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index('projects_user_id_idx').on(t.userId),
}))

export const iterations = pgTable('iterations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userMessage: text('user_message').notNull(),
  imageBlobUrl: text('image_blob_url'),
  jscadCode: text('jscad_code'),
  validationReport: jsonb('validation_report'),
  strategy: text('strategy', { enum: iterationStrategies })
    .notNull()
    .default('parametric'),
  meshBlobUrl: text('mesh_blob_url'),
  status: text('status', { enum: ['generating', 'ready', 'failed', 'sliced'] }).notNull(),
  error: text('error'),
  slicedBlobUrl: text('sliced_blob_url'),
  slicedMeta: jsonb('sliced_meta'),
  slicedAt: timestamp('sliced_at', { withTimezone: true }),
  baseMode: text('base_mode', { enum: ['mesh_only', 'with_base'] }),
  imageDescription: text('image_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectCreatedIdx: index('iterations_project_id_created_at_idx').on(t.projectId, t.createdAt),
  statusCheck: check('iterations_status_check', sql`${t.status} IN ('generating','ready','failed','sliced')`),
  baseModeCheck: check('iterations_base_mode_check', sql`${t.baseMode} IS NULL OR ${t.baseMode} IN ('mesh_only','with_base')`),
  // Inline the values as SQL literals (sql.raw) — a CHECK constraint cannot carry
  // bound parameters, and `sql`${s}`` would emit $1..$N placeholders that drizzle-kit
  // bakes into the DDL, producing an un-appliable migration. The list is hardcoded
  // safe identifiers, so raw interpolation is injection-free.
  strategyCheck: check('iterations_strategy_check', sql`${t.strategy} IN (${sql.raw(iterationStrategies.map((s) => `'${s}'`).join(', '))})`),
}))

export const projectsRelations = relations(projects, ({ many, one }) => ({
  iterations: many(iterations),
  user: one(users, { fields: [projects.userId], references: [users.id] }),
}))

export const iterationsRelations = relations(iterations, ({ one }) => ({
  project: one(projects, { fields: [iterations.projectId], references: [projects.id] }),
}))
