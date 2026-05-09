import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

const DecisionDatastore = DefineDatastore({
  name: "decisions",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    name: { type: Schema.types.string },
    proposal: { type: Schema.types.string },
    success_criteria: { type: Schema.types.string },
    quorum: { type: Schema.types.number },
    required_voters_count: { type: Schema.types.number },
    deadline: { type: Schema.types.string },
    deadline_resolved: { type: Schema.types.string },
    deadline_tz: { type: Schema.types.string },
    channel_id: { type: Schema.types.string },
    creator_id: { type: Schema.types.string },
    message_ts: { type: Schema.types.string },
    status: { type: Schema.types.string },
    outcome_reason: { type: Schema.types.string },
    finalized_at: { type: Schema.types.string },
    created_at: { type: Schema.types.string },
    updated_at: { type: Schema.types.string },
  },
});

export default DecisionDatastore;
