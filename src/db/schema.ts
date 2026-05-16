import { pgTable, text, timestamp, uuid, jsonb, primaryKey, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  currentIterationId: uuid('current_iteration_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const iterations = pgTable('iterations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentIterationId: uuid('parent_iteration_id'),
  userMessage: text('user_message').notNull(),
  imageBlobUrl: text('image_blob_url'),
  jscadCode: text('jscad_code'),
  validationReport: jsonb('validation_report'),
  strategy: text('strategy', { enum: ['parametric', 'generative'] })
    .notNull()
    .default('parametric'),
  meshBlobUrl: text('mesh_blob_url'),
  status: text('status', { enum: ['generating', 'ready', 'failed', 'sliced'] }).notNull(),
  error: text('error'),
  slicedBlobUrl: text('sliced_blob_url'),
  slicedMeta: jsonb('sliced_meta'),
  slicedAt: timestamp('sliced_at'),
  baseMode: text('base_mode', { enum: ['mesh_only', 'with_base'] }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const projectsRelations = relations(projects, ({ many, one }) => ({
  iterations: many(iterations),
  user: one(users, { fields: [projects.userId], references: [users.id] }),
}))

export const iterationsRelations = relations(iterations, ({ one }) => ({
  project: one(projects, { fields: [iterations.projectId], references: [projects.id] }),
}))
