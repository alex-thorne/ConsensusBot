import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Datastore for tracking decision metadata
 */
const DecisionDatastore = DefineDatastore({
  name: "decisions",
  primary_key: "id",
  attributes: {
    id: {
      type: Schema.types.string,
      required: true,
    },
    name: {
      type: Schema.types.string,
      required: true,
    },
    proposal: {
      type: Schema.types.string,
      required: true,
    },
    success_criteria: {
      type: Schema.types.string,
      required: true,
    },
    deadline: {
      type: Schema.types.string,
      required: true,
    },
    channel_id: {
      type: Schema.types.string,
      required: true,
    },
    creator_id: {
      type: Schema.types.string,
      required: true,
    },
    message_ts: {
      type: Schema.types.string,
      required: true,
    },
    status: {
      type: Schema.types.string,
      required: true,
    },
    created_at: {
      type: Schema.types.string,
      required: true,
    },
    updated_at: {
      type: Schema.types.string,
      required: true,
    },
  },
});

export default DecisionDatastore;
