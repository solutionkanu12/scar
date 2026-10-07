CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`permissions` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason_code` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorizations_action_id_unique` ON `authorizations` (`action_id`);--> statement-breakpoint
CREATE TABLE `base_execution_receipts` (
	`action_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`network` text NOT NULL,
	`chain_id` integer NOT NULL,
	`token_address` text NOT NULL,
	`recipient` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`block_number` text NOT NULL,
	`outcome` text NOT NULL,
	`submitted_at` text NOT NULL,
	`resolved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`action_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`external_reference` text,
	`error_code` text
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_agent_id` text NOT NULL,
	`related_action_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`action_type` text NOT NULL,
	`context` text NOT NULL,
	`outcome` text NOT NULL,
	`severity` text NOT NULL,
	`reason` text NOT NULL,
	`mitigation` text NOT NULL,
	`evidence` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `protected_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`action_type` text NOT NULL,
	`amount_atomic` text NOT NULL,
	`entity_id` text NOT NULL,
	`recipient` text NOT NULL,
	`chain_id` integer NOT NULL,
	`proposed_at` text NOT NULL
);
