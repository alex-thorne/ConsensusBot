/**
 * ConsensusBot v2.0 — Slack app manifest (Wave 0 stub).
 *
 * SPEC: docs/REDEVELOPMENT_SPECIFICATION.md §4.
 *
 * This is the Wave-0 scaffold. `workflows` and `datastores` are filled in
 * by Wave 5 (T-501). The 13-scope `botScopes` list is final per §4 and
 * MUST NOT be reduced; later waves only add entries when SPEC amendments
 * require them.
 */
import { Manifest } from "deno-slack-sdk/mod.ts";

export default Manifest({
  name: "ConsensusBot",
  description:
    "Facilitate team decision-making through collaborative consensus building",
  icon: "assets/icon.png",
  workflows: [],
  datastores: [],
  outgoingDomains: [],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
    "pins:read",
    "pins:write",
    "team:read",
    "users:read",
    "usergroups:read",
    "channels:read",
    "groups:read",
    "im:write",
  ],
});
