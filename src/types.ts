export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  MAP_DATA: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
};

export type Variables = {
  user: { id: number; username: string; role: string; full_name: string };
  userId: number;
};

export type Env = { Bindings: Bindings; Variables: Variables };
