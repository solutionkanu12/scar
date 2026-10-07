CREATE TABLE `scar_workspace_execution_configurations` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`executor_key_reference` text,
	`chain_id` integer,
	`token_address` text,
	`configured_by` text,
	`configured_at` text
);
--> statement-breakpoint
CREATE TABLE `scar_workspace_memberships` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership` text NOT NULL,
	`status` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	PRIMARY KEY(`workspace_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `scar_workspace_role_assignments` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`assigned_by` text NOT NULL,
	`assigned_at` text NOT NULL,
	`revoked_by` text,
	`revoked_at` text,
	PRIMARY KEY(`workspace_id`, `user_id`, `role`)
);
--> statement-breakpoint
CREATE TABLE `scar_workspace_role_audit_events` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`change` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `scar_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
