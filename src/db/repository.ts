import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { exchanges, gameScores, savedLocations, users } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName: string,
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email: email || 'unknown@local',
        displayName: displayName || 'Architect',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || 'unknown@local',
          displayName: displayName || 'Architect',
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (getOrCreateUser):', error);
    throw new Error('Failed to synchronize user profile.', { cause: error });
  }
}

export async function getUserExchanges(userId: number, limitCount = 60) {
  try {
    const rows = await db
      .select()
      .from(exchanges)
      .where(eq(exchanges.userId, userId))
      .orderBy(desc(exchanges.id))
      .limit(limitCount);
    return rows.reverse();
  } catch (error) {
    console.error('Database query failed (getUserExchanges):', error);
    throw new Error('Failed to load conversation history.', { cause: error });
  }
}

export async function insertExchange(input: {
  userId: number;
  role: 'user' | 'model';
  content: string;
  mode: string;
  source: string;
  latencyMs?: number | null;
}) {
  try {
    const rows = await db
      .insert(exchanges)
      .values({
        userId: input.userId,
        role: input.role,
        content: input.content,
        mode: input.mode,
        source: input.source,
        latencyMs: input.latencyMs ?? null,
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database query failed (insertExchange):', error);
    throw new Error('Failed to save exchange record.', { cause: error });
  }
}

export async function clearUserExchanges(userId: number) {
  try {
    await db.delete(exchanges).where(eq(exchanges.userId, userId));
  } catch (error) {
    console.error('Database query failed (clearUserExchanges):', error);
    throw new Error('Failed to clear conversation history.', { cause: error });
  }
}

export async function getUserLocations(userId: number) {
  try {
    return await db
      .select()
      .from(savedLocations)
      .where(eq(savedLocations.userId, userId))
      .orderBy(desc(savedLocations.id))
      .limit(50);
  } catch (error) {
    console.error('Database query failed (getUserLocations):', error);
    throw new Error('Failed to load saved locations.', { cause: error });
  }
}

export async function insertLocation(input: {
  userId: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mapsUri: string;
  notes: string;
}) {
  try {
    const rows = await db
      .insert(savedLocations)
      .values({
        userId: input.userId,
        name: input.name,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        mapsUri: input.mapsUri,
        notes: input.notes,
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database query failed (insertLocation):', error);
    throw new Error('Failed to save location.', { cause: error });
  }
}

export async function removeUserLocation(userId: number, locationId: number) {
  try {
    await db
      .delete(savedLocations)
      .where(
        and(eq(savedLocations.id, locationId), eq(savedLocations.userId, userId)),
      );
  } catch (error) {
    console.error('Database query failed (removeUserLocation):', error);
    throw new Error('Failed to delete saved location.', { cause: error });
  }
}

export async function getUserScores(userId: number) {
  try {
    return await db
      .select()
      .from(gameScores)
      .where(eq(gameScores.userId, userId))
      .orderBy(desc(gameScores.score))
      .limit(10);
  } catch (error) {
    console.error('Database query failed (getUserScores):', error);
    throw new Error('Failed to load high scores.', { cause: error });
  }
}

export async function insertGameScore(input: {
  userId: number;
  score: number;
  wave: number;
  accuracyPct: number;
}) {
  try {
    const rows = await db
      .insert(gameScores)
      .values({
        userId: input.userId,
        score: input.score,
        wave: input.wave,
        accuracyPct: input.accuracyPct,
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database query failed (insertGameScore):', error);
    throw new Error('Failed to save game score.', { cause: error });
  }
}
