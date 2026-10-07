declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SCAR_PUBLIC_ORIGIN?: string;
    SCAR_MULTI_WORKSPACE_OPERATIONS_ENABLED?: string;
    SCAR_SUPABASE_AUTH_ISSUER?: string;
    SCAR_AGENT_CREDENTIAL_PEPPER?: string;
    SCAR_SIBYL_BASE_URL?: string;
    SCAR_SIBYL_TOKEN?: string;
    SCAR_SIBYL_TENANT_SIGNING_KEY?: string;
    SCAR_POLICY_VERSION?: string;
    SCAR_POLICY_MAX_AMOUNT_ATOMIC?: string;
    SCAR_POLICY_REVIEW_AMOUNT_ATOMIC?: string;
    SCAR_POLICY_ALLOWED_CHAIN_IDS?: string;
    SCAR_BASE_SEPOLIA_RPC_URL?: string;
    SCAR_BASE_EXECUTOR_PRIVATE_KEY?: string;
    SCAR_BASE_EXECUTOR_KEY_REFERENCE?: string;
    SCAR_BASE_USDC_ADDRESS?: string;
  }
}
