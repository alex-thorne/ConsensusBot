import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Datastore for tracking required voters per decision
 */
const VoterDatastore = DefineDatastore({
  name: "voters",
  primary_key: "id",
  attributes: {
    id: {
      type: Schema.types.string,
      required: true,
    },
    decision_id: {
      type: Schema.types.string,
      required: true,
    },
    user_id: {
      type: Schema.types.string,
      required: true,
    },
    required: {
      type: Schema.types.boolean,
      required: true,
    },
    created_at: {
      type: Schema.types.string,
      required: true,
    },
  },
});

export default VoterDatastore;
