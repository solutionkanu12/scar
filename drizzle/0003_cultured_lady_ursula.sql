CREATE TABLE `scar_agent_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`allowed_operations` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scar_agent_credentials_secret_hash_unique` ON `scar_agent_credentials` (`secret_hash`);--> statement-breakpoint
CREATE TABLE `scar_http_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`request_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`operation` text NOT NULL,
	`action_id` text,
	`incident_id` text,
	`outcome` text NOT NULL,
	`status_code` integer NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scar_http_rate_limit_buckets` (
	`organization_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`operation` text NOT NULL,
	`window_started_at` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `principal_id`, `operation`, `window_started_at`)
);
--> statement-breakpoint
CREATE TABLE `scar_human_roles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
