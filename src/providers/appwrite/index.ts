import { Client, Users, TablesDB, Storage, Teams, Query } from 'node-appwrite';
import type {
  CleanupProvider,
  CleanupHandler,
  CleanupUntrackedOptions,
  CleanupUntrackedResult,
} from '../../core/cleanup/types.js';
import type { TrackedResource } from '../../integration/index.js';

interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
}

export function createAppwriteProvider(config: AppwriteConfig): CleanupProvider {
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);

  const tablesDB = new TablesDB(client);
  const storage = new Storage(client);
  const teams = new Teams(client);
  const users = new Users(client);

  const methods: Record<string, CleanupHandler> = {
    deleteRow: async (resource: TrackedResource) => {
      const databaseId = resource.databaseId as string;
      const tableId = resource.tableId as string;

      if (!databaseId || !tableId) {
        throw new Error(`Missing databaseId or tableId for row ${resource.id}`);
      }

      await tablesDB.deleteRow({
        databaseId,
        tableId,
        rowId: resource.id,
      });
    },

    deleteFile: async (resource: TrackedResource) => {
      const bucketId = resource.bucketId as string;

      if (!bucketId) {
        throw new Error(`Missing bucketId for file ${resource.id}`);
      }

      await storage.deleteFile(bucketId, resource.id);
    },

    deleteTeam: async (resource: TrackedResource) => {
      await teams.delete(resource.id);
    },

    deleteUser: async (resource: TrackedResource) => {
      await users.delete(resource.id);
    },

    deleteMembership: async (resource: TrackedResource) => {
      const teamId = resource.teamId as string;

      if (!teamId) {
        throw new Error(`Missing teamId for membership ${resource.id}`);
      }

      await teams.deleteMembership(teamId, resource.id);
    },
  };

  /**
   * Scan all Appwrite tables for resources created after testStartTime
   * that contain the userId in any field, and delete them.
   */
  async function cleanupUntracked(
    options: CleanupUntrackedOptions
  ): Promise<CleanupUntrackedResult> {
    const {
      testStartTime,
      testStartTimeProvided,
      userId: providedUserId,
      userEmail,
      sessionId,
    } = options;
    const deleted: string[] = [];
    const failed: string[] = [];
    let scanned = 0;
    let userId = providedUserId;
    let effectiveTestStartTime = testStartTime;
    let resolvedUserCreatedAt: string | undefined;

    const normalizePermissions = (permissions: unknown): string[] => {
      if (!Array.isArray(permissions)) return [];
      return permissions.filter((entry): entry is string => typeof entry === 'string');
    };

    const permissionHasPrincipal = (permission: string, principal: string): boolean => {
      if (permission.includes(`"${principal}"`)) return true;
      return permission.includes(principal);
    };

    const permissionBelongsToPrincipals = (permission: string, principals: Set<string>): boolean => {
      for (const principal of principals) {
        if (permissionHasPrincipal(permission, principal)) {
          return true;
        }
      }
      return false;
    };

    const onlyPermissionsFor = (permissions: string[], principals: Set<string>): boolean => {
      if (permissions.length === 0) return false;
      return permissions.every((permission) => permissionBelongsToPrincipals(permission, principals));
    };

    const valueContainsMatch = (value: unknown, needles: string[]): boolean => {
      if (value == null) return false;
      if (typeof value === 'string') {
        return needles.some((needle) => value.includes(needle));
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        const strValue = String(value);
        return needles.some((needle) => strValue.includes(needle));
      }
      if (Array.isArray(value)) {
        return value.some((entry) => valueContainsMatch(entry, needles));
      }
      if (typeof value === 'object') {
        for (const entry of Object.values(value as Record<string, unknown>)) {
          if (valueContainsMatch(entry, needles)) {
            return true;
          }
        }
      }
      return false;
    };

    console.log(
      `[Appwrite Cleanup] Starting untracked cleanup for session ${sessionId || 'unknown'}`
    );
    console.log(`[Appwrite Cleanup] Test start time: ${testStartTime}`);
    console.log(`[Appwrite Cleanup] User ID to match: ${userId || 'none'}`);
    console.log(`[Appwrite Cleanup] User email to match: ${userEmail || 'none'}`);

    try {
      if (!userId && userEmail) {
        try {
          const usersResult = await users.list([
            Query.equal('email', userEmail),
            Query.limit(1),
          ]);
          const matchedUser = usersResult.users?.[0];
          if (matchedUser?.$id) {
            userId = matchedUser.$id;
            if (typeof matchedUser.$createdAt === 'string') {
              resolvedUserCreatedAt = matchedUser.$createdAt;
            }
            console.log(`[Appwrite Cleanup] Resolved userId from email: ${userId}`);
          }
        } catch (error) {
          console.warn('[Appwrite Cleanup] Failed to resolve userId from email:', error);
        }
      }

      if (!testStartTimeProvided && userId && !resolvedUserCreatedAt) {
        try {
          const userRecord = await users.get(userId);
          if (typeof userRecord.$createdAt === 'string') {
            resolvedUserCreatedAt = userRecord.$createdAt;
          }
        } catch (error) {
          console.warn('[Appwrite Cleanup] Failed to resolve user creation time:', error);
        }
      }

      if (!testStartTimeProvided && resolvedUserCreatedAt) {
        effectiveTestStartTime = resolvedUserCreatedAt;
        console.log(
          `[Appwrite Cleanup] Using user createdAt as test start time: ${effectiveTestStartTime}`
        );
      }

      console.log(`[Appwrite Cleanup] Effective start time: ${effectiveTestStartTime}`);

      const ownedTeamIds = new Set<string>();
      if (userId) {
        try {
          console.log('[Appwrite Cleanup] Listing teams for ownership checks...');
          let hasMoreTeams = true;
          let teamCursor: string | undefined;

          while (hasMoreTeams) {
            const teamQueries = [
              Query.greaterThanEqual('$createdAt', effectiveTestStartTime),
              Query.limit(100),
            ];
            if (teamCursor) {
              teamQueries.push(Query.cursorAfter(teamCursor));
            }

            const teamsList = await teams.list(teamQueries);
            for (const team of teamsList.teams) {
              let membershipCursor: string | undefined;
              let hasMoreMembers = true;
              const memberUserIds: string[] = [];

              while (hasMoreMembers) {
                const memberQueries = [Query.limit(100)];
                if (membershipCursor) {
                  memberQueries.push(Query.cursorAfter(membershipCursor));
                }

                const memberships = await teams.listMemberships(team.$id, memberQueries);
                for (const membership of memberships.memberships) {
                  if (membership.userId) {
                    memberUserIds.push(membership.userId);
                  }
                }

                if (memberships.memberships.length < 100) {
                  hasMoreMembers = false;
                } else {
                  membershipCursor = memberships.memberships[memberships.memberships.length - 1].$id;
                }
              }

              const uniqueMembers = new Set(memberUserIds);
              if (uniqueMembers.size === 1 && uniqueMembers.has(userId)) {
                ownedTeamIds.add(team.$id);
              }
            }

            if (teamsList.teams.length < 100) {
              hasMoreTeams = false;
            } else {
              teamCursor = teamsList.teams[teamsList.teams.length - 1].$id;
            }
          }

          if (ownedTeamIds.size > 0) {
            console.log(`[Appwrite Cleanup] Found ${ownedTeamIds.size} user-owned teams`);
          }
        } catch (error) {
          console.warn('[Appwrite Cleanup] Failed to list teams for ownership checks:', error);
        }
      }

      const userPrincipals = new Set<string>();
      if (userId) {
        userPrincipals.add(`user:${userId}`);
      }
      for (const teamId of ownedTeamIds) {
        userPrincipals.add(`team:${teamId}`);
      }

      // 1. List all databases
      console.log('[Appwrite Cleanup] Listing databases...');
      const databases = await tablesDB.list();
      console.log(
        `[Appwrite Cleanup] Found ${databases.databases.length} databases to scan`
      );

      for (const db of databases.databases) {
        // 2. List all tables in each database
        console.log(`[Appwrite Cleanup] Listing tables for database ${db.$id}...`);
        const tables = await tablesDB.listTables({ databaseId: db.$id });
        console.log(
          `[Appwrite Cleanup] Database "${db.name}" (${db.$id}): ${tables.tables.length} tables`
        );

        for (const table of tables.tables) {
          // Skip tracking tables (tables starting with _intellitester)
          if (table.name.startsWith('_intellitester')) {
            console.log(
              `[Appwrite Cleanup] Skipping tracking table: ${table.name}`
            );
            continue;
          }

          scanned++;

          try {
            // 3. Query for rows created after testStartTime with pagination
            let hasMore = true;
            let cursor: string | undefined;

            let tableMatchesFound = 0;
            while (hasMore) {
              const queries = [
                Query.greaterThanEqual('$createdAt', effectiveTestStartTime),
                Query.orderAsc('$createdAt'),
                Query.orderAsc('$id'),
                Query.limit(100),
              ];

              if (cursor) {
                queries.push(Query.cursorAfter(cursor));
              }

              const rows = await tablesDB.listRows({
                databaseId: db.$id,
                tableId: table.$id,
                queries,
              });

              for (const row of rows.rows) {
                const matchNeedles = [userId, userEmail].filter(
                  (needle): needle is string => Boolean(needle)
                );
                const rowPermissions = normalizePermissions(
                  (row as Record<string, unknown>).$permissions ??
                  (row as Record<string, unknown>).permissions
                );
                const hasOnlyUserPermissions = onlyPermissionsFor(rowPermissions, userPrincipals);
                const matchesValues = matchNeedles.length > 0
                  ? valueContainsMatch(row, matchNeedles)
                  : false;
                const matchesRowId = Boolean(userId && row.$id === userId);

                const shouldDelete = matchesRowId || matchesValues || hasOnlyUserPermissions;

                if (shouldDelete) {
                  tableMatchesFound++;
                  try {
                    await tablesDB.deleteRow({
                      databaseId: db.$id,
                      tableId: table.$id,
                      rowId: row.$id,
                    });
                    deleted.push(`row:${db.$id}/${table.$id}/${row.$id}`);
                    console.log(
                      `[Appwrite Cleanup] Deleted row ${row.$id} from ${table.name}`
                    );
                  } catch (error) {
                    failed.push(`row:${db.$id}/${table.$id}/${row.$id}`);
                    console.warn(
                      `[Appwrite Cleanup] Failed to delete row ${row.$id}:`,
                      error
                    );
                  }
                }
              }

              // Check if we need to paginate
              if (rows.rows.length < 100) {
                hasMore = false;
              } else {
                cursor = rows.rows[rows.rows.length - 1].$id;
              }
            }

            if (tableMatchesFound > 0) {
              console.log(
                `[Appwrite Cleanup] Table "${table.name}": matched ${tableMatchesFound} rows for cleanup`
              );
            }
          } catch (error) {
            console.warn(
              `[Appwrite Cleanup] Error scanning table ${table.name}:`,
              error
            );
          }
        }
      }

      // 5. Scan storage buckets for files
      console.log('[Appwrite Cleanup] Listing storage buckets...');
      const buckets = await storage.listBuckets([
        Query.greaterThanEqual('$createdAt', effectiveTestStartTime),
        Query.limit(100),
      ]);
      console.log(
        `[Appwrite Cleanup] Found ${buckets.buckets.length} buckets to scan`
      );

      for (const bucket of buckets.buckets) {
        scanned++;
        const bucketPermissions = normalizePermissions(
          (bucket as Record<string, unknown>).$permissions ??
          (bucket as Record<string, unknown>).permissions
        );
        const bucketMatchesId = Boolean(userId && bucket.$id === userId);
        const bucketMatchesOwnedTeam = Boolean(
          ownedTeamIds.size > 0 && ownedTeamIds.has(bucket.$id)
        );
        const bucketMatchesName = Boolean(
          (userId && bucket.name.includes(userId)) ||
          (userEmail && bucket.name.includes(userEmail))
        );
        const bucketHasOnlyUserPermissions = onlyPermissionsFor(bucketPermissions, userPrincipals);
        const bucketNeedles = [userId, userEmail].filter(
          (needle): needle is string => Boolean(needle)
        );
        const bucketMatchesValues = bucketNeedles.length > 0
          ? valueContainsMatch(bucket, bucketNeedles)
          : false;
        const bucketShouldDelete =
          bucketMatchesId ||
          bucketMatchesOwnedTeam ||
          bucketMatchesName ||
          bucketHasOnlyUserPermissions ||
          bucketMatchesValues;

        try {
          let hasMore = true;
          let cursor: string | undefined;

          let bucketMatchesFound = 0;
          while (hasMore) {
            const queries = bucketShouldDelete
              ? [Query.orderAsc('$id'), Query.limit(100)]
              : [
                Query.greaterThanEqual('$createdAt', effectiveTestStartTime),
                Query.orderAsc('$createdAt'),
                Query.orderAsc('$id'),
                Query.limit(100),
              ];

            if (cursor) {
              queries.push(Query.cursorAfter(cursor));
            }

            const files = await storage.listFiles({
              bucketId: bucket.$id,
              queries,
            });

            for (const file of files.files) {
              // Files don't have custom fields, but check name patterns
              // Note: $createdBy might not exist on all file objects
              const fileRecord = file as Record<string, unknown>;
              const createdBy = fileRecord.$createdBy as string | undefined;
              const filePermissions = normalizePermissions(
                fileRecord.$permissions ?? fileRecord.permissions
              );
              const fileHasOnlyUserPermissions = onlyPermissionsFor(filePermissions, userPrincipals);
              const fileNeedles = [userId, userEmail].filter(
                (needle): needle is string => Boolean(needle)
              );
              const fileMatchesValues = fileNeedles.length > 0
                ? valueContainsMatch(fileRecord, fileNeedles)
                : false;
              const shouldDelete =
                bucketShouldDelete ||
                fileHasOnlyUserPermissions ||
                fileMatchesValues ||
                (userId && createdBy === userId);

              if (shouldDelete) {
                bucketMatchesFound++;
                try {
                  await storage.deleteFile({
                    bucketId: bucket.$id,
                    fileId: file.$id,
                  });
                  deleted.push(`file:${bucket.$id}/${file.$id}`);
                  console.log(
                    `[Appwrite Cleanup] Deleted file ${file.$id} from bucket ${bucket.name}`
                  );
                } catch (error) {
                  failed.push(`file:${bucket.$id}/${file.$id}`);
                  console.warn(
                    `[Appwrite Cleanup] Failed to delete file ${file.$id}:`,
                    error
                  );
                }
              }
            }

            // Check if we need to paginate
            if (files.files.length < 100) {
              hasMore = false;
            } else {
              cursor = files.files[files.files.length - 1].$id;
            }
          }

          if (bucketMatchesFound > 0) {
            console.log(
              `[Appwrite Cleanup] Bucket "${bucket.name}": matched ${bucketMatchesFound} files for cleanup`
            );
          }
        } catch (error) {
          console.warn(
            `[Appwrite Cleanup] Error scanning bucket ${bucket.name}:`,
            error
          );
        }

        if (bucketShouldDelete) {
          try {
            await storage.deleteBucket(bucket.$id);
            deleted.push(`bucket:${bucket.$id}`);
            console.log(`[Appwrite Cleanup] Deleted bucket ${bucket.name} (${bucket.$id})`);
          } catch (error) {
            failed.push(`bucket:${bucket.$id}`);
            console.warn(`[Appwrite Cleanup] Failed to delete bucket ${bucket.$id}:`, error);
          }
        }
      }

      // 6. Delete the test user last
      if (userId) {
        console.log(`[Appwrite Cleanup] Deleting test user: ${userId}`);
        try {
          await users.delete(userId);
          deleted.push(`user:${userId}`);
          console.log(`[Appwrite Cleanup] Deleted user ${userId}`);
        } catch (error) {
          failed.push(`user:${userId}`);
          console.warn(
            `[Appwrite Cleanup] Failed to delete user ${userId}:`,
            error
          );
        }
      } else if (userEmail) {
        try {
          const usersResult = await users.list([
            Query.equal('email', userEmail),
            Query.limit(10),
          ]);
          for (const user of usersResult.users ?? []) {
            try {
              await users.delete(user.$id);
              deleted.push(`user:${user.$id}`);
              console.log(`[Appwrite Cleanup] Deleted user ${user.$id} (matched by email)`);
            } catch (error) {
              failed.push(`user:${user.$id}`);
              console.warn(`[Appwrite Cleanup] Failed to delete user ${user.$id}:`, error);
            }
          }
        } catch (error) {
          console.warn('[Appwrite Cleanup] Failed to delete users by email:', error);
        }
      }
    } catch (error) {
      console.error('[Appwrite Cleanup] Error during cleanup scan:', error);
    }

    console.log(
      `[Appwrite Cleanup] Cleanup complete. Scanned: ${scanned}, Deleted: ${deleted.length}, Failed: ${failed.length}`
    );

    return {
      success: failed.length === 0,
      scanned,
      deleted,
      failed,
    };
  }

  return {
    name: 'appwrite',
    async configure() {
      // Client is already configured in the factory function
      // This is called by the cleanup executor but we don't need to do anything
    },
    methods,
    cleanupUntracked,
  };
}

// Default type mappings for Appwrite resources
export const appwriteTypeMappings: Record<string, string> = {
  row: 'appwrite.deleteRow',
  file: 'appwrite.deleteFile',
  team: 'appwrite.deleteTeam',
  user: 'appwrite.deleteUser',
  membership: 'appwrite.deleteMembership',
};
