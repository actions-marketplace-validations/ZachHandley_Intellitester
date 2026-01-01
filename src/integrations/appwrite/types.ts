export interface TrackedResource {
  type: 'row' | 'file' | 'user' | 'team' | 'membership' | 'message';
  id: string;
  // For rows
  databaseId?: string;
  tableId?: string;
  // For files
  bucketId?: string;
  // For teams/memberships
  teamId?: string;
  createdAt: string;
  deleted?: boolean;  // Mark as deleted if we see a DELETE request
}

export interface TestContext {
  userId?: string;
  userEmail?: string;
  resources: TrackedResource[];
  variables: Map<string, string>;
}

export interface AppwriteCleanupConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
  cleanup: boolean;
  cleanupOnFailure?: boolean;
}

// Network interception patterns for resource creation (POST)
export const APPWRITE_PATTERNS = {
  userCreate: /\/v1\/account$/,
  rowCreate: /\/v1\/tablesdb\/([\w-]+)\/tables\/([\w-]+)\/rows$/,
  fileCreate: /\/v1\/storage\/buckets\/([\w-]+)\/files$/,
  teamCreate: /\/v1\/teams$/,
  membershipCreate: /\/v1\/teams\/([\w-]+)\/memberships$/,
  messageCreate: /\/v1\/messaging\/messages$/,
};

// Network interception patterns for resource updates (PUT/PATCH)
export const APPWRITE_UPDATE_PATTERNS = {
  rowUpdate: /\/v1\/tablesdb\/([\w-]+)\/tables\/([\w-]+)\/rows\/([\w-]+)$/,
  fileUpdate: /\/v1\/storage\/buckets\/([\w-]+)\/files\/([\w-]+)$/,
  teamUpdate: /\/v1\/teams\/([\w-]+)$/,
};

// Network interception patterns for resource deletions (DELETE)
export const APPWRITE_DELETE_PATTERNS = {
  rowDelete: /\/v1\/tablesdb\/([\w-]+)\/tables\/([\w-]+)\/rows\/([\w-]+)$/,
  fileDelete: /\/v1\/storage\/buckets\/([\w-]+)\/files\/([\w-]+)$/,
  teamDelete: /\/v1\/teams\/([\w-]+)$/,
  membershipDelete: /\/v1\/teams\/([\w-]+)\/memberships\/([\w-]+)$/,
};
