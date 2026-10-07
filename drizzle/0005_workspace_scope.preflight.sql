-- Read-only preflight for drizzle/0005_workspace_scope.sql.
--
-- Run this exact SELECT against a D1 database after 0004 and before 0005.
-- It contains no PRAGMA, DDL, DML, or transaction statements.
--
-- PASS: exactly one row, result=PASS, affected_rows=0.
-- FAIL: a summary row followed by one row per collision/corruption. Do not
-- apply 0005 until every FAIL row is resolved. A SQL error also means FAIL:
-- the database is not at the expected 0000-0004 legacy schema.
WITH
  issues(check_name, detail, affected_rows) AS (
    -- 0005 uses INSERT OR IGNORE for this sealed namespace. A pre-existing
    -- namespace could expose historical records or leave execution enabled.
    SELECT
      'legacy_workspace_namespace_already_present',
      'workspace:legacy exists in scar_workspaces',
      COUNT(*)
    FROM scar_workspaces
    WHERE id = 'workspace:legacy'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT
      'legacy_workspace_namespace_already_present',
      'workspace:legacy exists in scar_workspace_execution_configurations',
      COUNT(*)
    FROM scar_workspace_execution_configurations
    WHERE workspace_id = 'workspace:legacy'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT
      'legacy_workspace_namespace_already_present',
      'workspace:legacy exists in scar_workspace_memberships',
      COUNT(*)
    FROM scar_workspace_memberships
    WHERE workspace_id = 'workspace:legacy'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT
      'legacy_workspace_namespace_already_present',
      'workspace:legacy exists in scar_workspace_role_assignments',
      COUNT(*)
    FROM scar_workspace_role_assignments
    WHERE workspace_id = 'workspace:legacy'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT
      'legacy_workspace_namespace_already_present',
      'workspace:legacy exists in scar_workspace_role_audit_events',
      COUNT(*)
    FROM scar_workspace_role_audit_events
    WHERE workspace_id = 'workspace:legacy'
    HAVING COUNT(*) > 0

    -- All pre-0005 organizations collapse into one legacy workspace. This
    -- is the one new key collision possible in a valid previous schema.
    UNION ALL
    SELECT
      'rate_limit_workspace_legacy_collision',
      'principal_id=' || principal_id || '; operation=' || operation ||
        '; window_started_at=' || window_started_at,
      row_count - 1
    FROM (
      SELECT principal_id, operation, window_started_at, COUNT(*) AS row_count
      FROM scar_http_rate_limit_buckets
      GROUP BY principal_id, operation, window_started_at
      HAVING COUNT(*) > 1
    )

    -- Corruption or non-standard historical schemas can violate the final
    -- workspace-scoped primary/unique keys even though normal old schemas
    -- already constrained most of these values.
    UNION ALL
    SELECT 'agents_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM agents GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'actions_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM protected_actions GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'incidents_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM incidents GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'incident_bundles_workspace_legacy_id_collision', 'incident_id=' || incident_id, COUNT(*) - 1
    FROM incident_memory_bundles GROUP BY incident_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'agent_credentials_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM scar_agent_credentials GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'agent_credentials_workspace_legacy_secret_hash_collision', 'secret_hash=' || secret_hash, COUNT(*) - 1
    FROM scar_agent_credentials GROUP BY secret_hash HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'http_audits_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM scar_http_audit_events GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'authorizations_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM authorizations GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'authorizations_workspace_legacy_action_collision', 'action_id=' || action_id, COUNT(*) - 1
    FROM authorizations GROUP BY action_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'approvals_workspace_legacy_id_collision', 'id=' || id, COUNT(*) - 1
    FROM approvals GROUP BY id HAVING COUNT(*) > 1
    UNION ALL
    SELECT
      'approvals_workspace_legacy_logical_collision',
      'action_id=' || action_id || '; authorization_id=' || authorization_id,
      COUNT(*) - 1
    FROM approvals
    GROUP BY action_id, authorization_id
    HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'executions_workspace_legacy_action_collision', 'action_id=' || action_id, COUNT(*) - 1
    FROM executions GROUP BY action_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'base_receipts_workspace_legacy_action_collision', 'action_id=' || action_id, COUNT(*) - 1
    FROM base_execution_receipts GROUP BY action_id HAVING COUNT(*) > 1

    -- Required values must survive the CREATE/INSERT sequence in 0005.
    UNION ALL
    SELECT 'agents_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM agents
    WHERE id IS NULL OR trim(id) = '' OR name IS NULL OR trim(name) = '' OR
      role IS NULL OR trim(role) = '' OR status IS NULL OR trim(status) = '' OR
      permissions IS NULL OR trim(permissions) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'actions_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM protected_actions
    WHERE id IS NULL OR trim(id) = '' OR agent_id IS NULL OR trim(agent_id) = '' OR
      action_type IS NULL OR trim(action_type) = '' OR amount_atomic IS NULL OR trim(amount_atomic) = '' OR
      entity_id IS NULL OR trim(entity_id) = '' OR recipient IS NULL OR trim(recipient) = '' OR
      chain_id IS NULL OR proposed_at IS NULL OR trim(proposed_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'incidents_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM incidents
    WHERE id IS NULL OR trim(id) = '' OR source_agent_id IS NULL OR trim(source_agent_id) = '' OR
      related_action_id IS NULL OR trim(related_action_id) = '' OR entity_id IS NULL OR trim(entity_id) = '' OR
      action_type IS NULL OR trim(action_type) = '' OR context IS NULL OR trim(context) = '' OR
      outcome IS NULL OR trim(outcome) = '' OR severity IS NULL OR trim(severity) = '' OR
      reason IS NULL OR trim(reason) = '' OR mitigation IS NULL OR trim(mitigation) = '' OR
      evidence IS NULL OR trim(evidence) = '' OR provenance IS NULL OR trim(provenance) = '' OR
      created_at IS NULL OR trim(created_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'incident_memory_bundles_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM incident_memory_bundles
    WHERE incident_id IS NULL OR trim(incident_id) = '' OR bundle IS NULL OR trim(bundle) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'agent_credentials_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM scar_agent_credentials
    WHERE id IS NULL OR trim(id) = '' OR agent_id IS NULL OR trim(agent_id) = '' OR
      secret_hash IS NULL OR trim(secret_hash) = '' OR allowed_operations IS NULL OR trim(allowed_operations) = '' OR
      status IS NULL OR trim(status) = '' OR created_at IS NULL OR trim(created_at) = '' OR
      expires_at IS NULL OR trim(expires_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'http_audits_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM scar_http_audit_events
    WHERE id IS NULL OR trim(id) = '' OR organization_id IS NULL OR trim(organization_id) = '' OR
      request_id IS NULL OR trim(request_id) = '' OR principal_type IS NULL OR trim(principal_type) = '' OR
      principal_id IS NULL OR trim(principal_id) = '' OR operation IS NULL OR trim(operation) = '' OR
      outcome IS NULL OR trim(outcome) = '' OR status_code IS NULL OR occurred_at IS NULL OR trim(occurred_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'rate_limits_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM scar_http_rate_limit_buckets
    WHERE organization_id IS NULL OR trim(organization_id) = '' OR principal_id IS NULL OR trim(principal_id) = '' OR
      operation IS NULL OR trim(operation) = '' OR window_started_at IS NULL OR trim(window_started_at) = '' OR
      count IS NULL
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'authorizations_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM authorizations
    WHERE id IS NULL OR trim(id) = '' OR action_id IS NULL OR trim(action_id) = '' OR
      decision IS NULL OR trim(decision) = '' OR reason_code IS NULL OR trim(reason_code) = '' OR
      rationale IS NULL OR trim(rationale) = '' OR evidence IS NULL OR trim(evidence) = '' OR
      provenance IS NULL OR trim(provenance) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'approvals_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM approvals
    WHERE id IS NULL OR trim(id) = '' OR action_id IS NULL OR trim(action_id) = '' OR
      authorization_id IS NULL OR trim(authorization_id) = '' OR approved_by IS NULL OR trim(approved_by) = '' OR
      approved_at IS NULL OR trim(approved_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'executions_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM executions
    WHERE action_id IS NULL OR trim(action_id) = '' OR id IS NULL OR trim(id) = '' OR
      authorization_id IS NULL OR trim(authorization_id) = '' OR status IS NULL OR trim(status) = '' OR
      started_at IS NULL OR trim(started_at) = ''
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'base_receipts_required_value_invalid', 'one or more required values are NULL or empty', COUNT(*)
    FROM base_execution_receipts
    WHERE action_id IS NULL OR trim(action_id) = '' OR agent_id IS NULL OR trim(agent_id) = '' OR
      authorization_id IS NULL OR trim(authorization_id) = '' OR network IS NULL OR trim(network) = '' OR
      chain_id IS NULL OR token_address IS NULL OR trim(token_address) = '' OR recipient IS NULL OR trim(recipient) = '' OR
      amount_atomic IS NULL OR trim(amount_atomic) = '' OR transaction_hash IS NULL OR trim(transaction_hash) = '' OR
      block_number IS NULL OR trim(block_number) = '' OR outcome IS NULL OR trim(outcome) = '' OR
      submitted_at IS NULL OR trim(submitted_at) = '' OR resolved_at IS NULL OR trim(resolved_at) = ''
    HAVING COUNT(*) > 0

    -- JSON is copied as opaque text by 0005. Invalid JSON would survive the
    -- SQL migration but fail the SCAR repository/domain parser afterwards.
    UNION ALL
    SELECT 'agents_permissions_malformed_json', 'permissions is not valid JSON', COUNT(*)
    FROM agents WHERE permissions IS NOT NULL AND json_valid(permissions) = 0
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'incidents_json_malformed', 'context, evidence, or provenance is not valid JSON', COUNT(*)
    FROM incidents
    WHERE (context IS NOT NULL AND json_valid(context) = 0) OR
      (evidence IS NOT NULL AND json_valid(evidence) = 0) OR
      (provenance IS NOT NULL AND json_valid(provenance) = 0)
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'incident_memory_bundle_malformed_json', 'bundle is not valid JSON', COUNT(*)
    FROM incident_memory_bundles WHERE bundle IS NOT NULL AND json_valid(bundle) = 0
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'agent_credentials_allowed_operations_malformed_json', 'allowed_operations is not valid JSON', COUNT(*)
    FROM scar_agent_credentials
    WHERE allowed_operations IS NOT NULL AND json_valid(allowed_operations) = 0
    HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'authorizations_json_malformed', 'evidence or provenance is not valid JSON', COUNT(*)
    FROM authorizations
    WHERE (evidence IS NOT NULL AND json_valid(evidence) = 0) OR
      (provenance IS NOT NULL AND json_valid(provenance) = 0)
    HAVING COUNT(*) > 0
  ),
  summary(affected_rows) AS (
    SELECT COALESCE(SUM(affected_rows), 0) FROM issues
  ),
  results(sort_order, result, check_name, detail, affected_rows) AS (
    SELECT
      0,
      CASE WHEN affected_rows = 0 THEN 'PASS' ELSE 'FAIL' END,
      '0005_workspace_scope_preflight',
      CASE WHEN affected_rows = 0 THEN 'all checks passed' ELSE 'one or more checks failed' END,
      affected_rows
    FROM summary
    UNION ALL
    SELECT 1, 'FAIL', check_name, detail, affected_rows FROM issues
  )
SELECT result, check_name, detail, affected_rows
FROM results
ORDER BY sort_order, check_name, detail;
