import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

const VoterDatastore = DefineDatastore({
  name: "voters",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    decision_id: { type: Schema.types.string },
    user_id: { type: Schema.types.string },
    is_active: { type: Schema.types.boolean },
    created_at: { type: Schema.types.string },
  },
});

export default VoterDatastore;
