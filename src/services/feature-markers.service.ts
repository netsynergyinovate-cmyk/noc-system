import "server-only";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { featureMarkers } from "@/db/schema";
import type {
  CreateFeatureMarkerInput,
  ListFeatureMarkersInput,
  UpdateFeatureMarkerInput,
} from "@/validators/feature-markers";

const markerFields = {
  id: featureMarkers.id,
  userId: featureMarkers.userId,
  userEmail: featureMarkers.userEmail,
  userRole: featureMarkers.userRole,
  pagePath: featureMarkers.pagePath,
  pageTitle: featureMarkers.pageTitle,
  elementSelector: featureMarkers.elementSelector,
  elementText: featureMarkers.elementText,
  featureName: featureMarkers.featureName,
  category: featureMarkers.category,
  frequency: featureMarkers.frequency,
  notes: featureMarkers.notes,
  status: featureMarkers.status,
  developerNotes: featureMarkers.developerNotes,
  createdAt: featureMarkers.createdAt,
  updatedAt: featureMarkers.updatedAt,
};

export async function createFeatureMarker(
  user: { id: string; email: string; role: string },
  input: CreateFeatureMarkerInput,
) {
  const [created] = await db
    .insert(featureMarkers)
    .values({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      pagePath: input.pagePath,
      pageTitle: input.pageTitle || "",
      elementSelector: input.elementSelector || "",
      elementText: input.elementText || "",
      featureName: input.featureName,
      category: input.category,
      frequency: input.frequency,
      notes: input.notes || "",
      status: "baru",
      developerNotes: "",
    })
    .returning(markerFields);

  return created;
}

export async function listFeatureMarkers(query: ListFeatureMarkersInput) {
  const conditions = [];

  if (query.pagePath) {
    conditions.push(eq(featureMarkers.pagePath, query.pagePath));
  }
  if (query.category) {
    conditions.push(eq(featureMarkers.category, query.category));
  }
  if (query.userRole) {
    conditions.push(eq(featureMarkers.userRole, query.userRole));
  }
  if (query.status) {
    conditions.push(eq(featureMarkers.status, query.status));
  }
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        ilike(featureMarkers.featureName, pattern),
        ilike(featureMarkers.notes, pattern),
        ilike(featureMarkers.elementText, pattern),
        ilike(featureMarkers.userEmail, pattern),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(markerFields)
    .from(featureMarkers)
    .where(whereClause)
    .orderBy(desc(featureMarkers.createdAt))
    .limit(query.limit + 1)
    .offset(query.offset);

  const hasMore = rows.length > query.limit;
  const data = rows.slice(0, query.limit);

  return {
    data,
    meta: {
      limit: query.limit,
      offset: query.offset,
      hasMore,
    },
  };
}
export async function getFeatureMarkerById(id: string) {
  const [row] = await db
    .select(markerFields)
    .from(featureMarkers)
    .where(eq(featureMarkers.id, id))
    .limit(1);

  return row ?? null;
}


export async function getFeatureMarkerStats() {
  const [stats] = await db
    .select({
      total: count(),
      frequentlyUsed: count(
        sql`CASE WHEN ${featureMarkers.category} = 'used_frequently' THEN 1 END`,
      ),
      rarelyUsed: count(
        sql`CASE WHEN ${featureMarkers.category} = 'rarely_used' THEN 1 END`,
      ),
      bugIssues: count(
        sql`CASE WHEN ${featureMarkers.category} = 'bug_issue' THEN 1 END`,
      ),
      improvements: count(
        sql`CASE WHEN ${featureMarkers.category} = 'improvement' THEN 1 END`,
      ),
      unreviewed: count(
        sql`CASE WHEN ${featureMarkers.status} = 'baru' THEN 1 END`,
      ),
    })
    .from(featureMarkers);

  return (
    stats ?? {
      total: 0,
      frequentlyUsed: 0,
      rarelyUsed: 0,
      bugIssues: 0,
      improvements: 0,
      unreviewed: 0,
    }
  );
}

export async function updateFeatureMarker(
  id: string,
  input: UpdateFeatureMarkerInput,
) {
  const updateData: Partial<typeof featureMarkers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.status !== undefined) {
    updateData.status = input.status;
  }
  if (input.developerNotes !== undefined) {
    updateData.developerNotes = input.developerNotes;
  }

  const [updated] = await db
    .update(featureMarkers)
    .set(updateData)
    .where(eq(featureMarkers.id, id))
    .returning(markerFields);

  return updated ?? null;
}

export async function deleteFeatureMarker(id: string) {
  const [deleted] = await db
    .delete(featureMarkers)
    .where(eq(featureMarkers.id, id))
    .returning({ id: featureMarkers.id });

  return Boolean(deleted);
}
