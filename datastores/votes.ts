import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

const VoteDatastore = DefineDatastore({
  name: "votes",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    decision_id: { type: Schema.types.string },
    user_id: { type: Schema.types.string },
    vote_type: { type: Schema.types.string },
    voted_at: { type: Schema.types.string },
  },
});

export default VoteDatastore;
