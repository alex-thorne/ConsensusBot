/**
 * ConsensusBot v2.0 — Slack app manifest.
 *
 * SPEC: docs/REDEVELOPMENT_SPECIFICATION.md §4.
 *
 * The 13-scope `botScopes` list is final per §4 and MUST NOT be reduced;
 * later waves only add entries when SPEC amendments require them.
 */
import { Manifest } from "deno-slack-sdk/mod.ts";

import DecisionDatastore from "./datastores/decisions.ts";
import VoteDatastore from "./datastores/votes.ts";
import VoterDatastore from "./datastores/voters.ts";
import VoteHistoryDatastore from "./datastores/vote_history.ts";

import CreateDecisionWorkflow from "./workflows/create_decision.ts";
import ProcessActiveDecisionsWorkflow from "./workflows/process_active_decisions.ts";

export default Manifest({
  name: "ConsensusBot",
  description:
    "Facilitate team decision-making through collaborative consensus building",
  icon: "assets/icon.png",
  workflows: [CreateDecisionWorkflow, ProcessActiveDecisionsWorkflow],
  datastores: [
    DecisionDatastore,
    VoteDatastore,
    VoterDatastore,
    VoteHistoryDatastore,
  ],
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
