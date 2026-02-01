import { Manifest } from "deno-slack-sdk/mod.ts";
import DecisionDatastore from "./datastores/decisions.ts";
import VoteDatastore from "./datastores/votes.ts";
import VoterDatastore from "./datastores/voters.ts";
import CreateDecisionWorkflow from "./workflows/create_decision.ts";
import VoteWorkflow from "./workflows/vote.ts";
import SendRemindersWorkflow from "./workflows/send_reminders.ts";

/**
 * The app manifest contains the app's configuration. This
 * file defines attributes like app name and description.
 * https://api.slack.com/automation/manifest
 */
export default Manifest({
  name: "ConsensusBot",
  description: "Facilitate team decision-making through collaborative consensus building",
  icon: "assets/icon.png",
  workflows: [
    CreateDecisionWorkflow,
    VoteWorkflow,
    SendRemindersWorkflow,
  ],
  datastores: [
    DecisionDatastore,
    VoteDatastore,
    VoterDatastore,
  ],
  outgoingDomains: [],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
    "datastore:read",
    "datastore:write",
    "pins:write",
    "users:read",
    "im:write",
  ],
});
