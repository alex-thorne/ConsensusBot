import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Datastore for tracking individual votes
 */
const VoteDatastore = DefineDatastore({
  name: "votes",
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
    vote_type: {
      type: Schema.types.string,
      required: true,
    },
    voted_at: {
      type: Schema.types.string,
      required: true,
    },
  },
});

export default VoteDatastore;
