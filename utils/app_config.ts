/**
 * Environment-aware application configuration
 *
 * Reads CONSENSUSBOT_ENV at runtime to determine the display name.
 * Set CONSENSUSBOT_ENV=local (or localtest) when running locally via
 * `slack run` to distinguish from the production instance.
 */

export { VERSION } from "./version.ts";

const env = Deno.env.get("CONSENSUSBOT_ENV");

/**
 * Display name for the app, shown in Slack messages.
 * - "ConsensusBot (local)" when CONSENSUSBOT_ENV is "local" or "localtest"
 * - "ConsensusBot" otherwise (production default)
 */
export const APP_NAME: string = env === "local" || env === "localtest"
  ? "ConsensusBot (local)"
  : "ConsensusBot";
