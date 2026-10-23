CREATE TABLE IF NOT EXISTS pr_split_requests (
 request_id TEXT NOT NULL,
 username TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(request_id,username)
);
