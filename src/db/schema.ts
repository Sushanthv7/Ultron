import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default('Architect'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const exchanges = pgTable('exchanges', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  mode: text('mode').notNull().default('architect'),
  source: text('source').notNull().default('Hub'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const savedLocations = pgTable('saved_locations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  address: text('address').notNull().default(''),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  mapsUri: text('maps_uri').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const gameScores = pgTable('game_scores', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  score: integer('score').notNull(),
  wave: integer('wave').notNull(),
  accuracyPct: integer('accuracy_pct').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  exchanges: many(exchanges),
  savedLocations: many(savedLocations),
  gameScores: many(gameScores),
}));

export const exchangesRelations = relations(exchanges, ({ one }) => ({
  user: one(users, {
    fields: [exchanges.userId],
    references: [users.id],
  }),
}));

export const savedLocationsRelations = relations(savedLocations, ({ one }) => ({
  user: one(users, {
    fields: [savedLocations.userId],
    references: [users.id],
  }),
}));

export const gameScoresRelations = relations(gameScores, ({ one }) => ({
  user: one(users, {
    fields: [gameScores.userId],
    references: [users.id],
  }),
}));
