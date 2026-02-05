#!/usr/bin/env bash
#
# Trigger Validation Script
#
# This script validates that the vote button trigger is correctly configured
# to work with the VoteWorkflow.
#

set -e

echo "🔍 Validating Vote Button Trigger Configuration..."
echo ""

# Check that trigger file exists
if [ ! -f "triggers/vote_button_trigger.ts" ]; then
    echo "❌ FAIL: triggers/vote_button_trigger.ts not found"
    exit 1
fi
echo "✅ Trigger file exists"

# Check that workflow file exists
if [ ! -f "workflows/vote.ts" ]; then
    echo "❌ FAIL: workflows/vote.ts not found"
    exit 1
fi
echo "✅ Workflow file exists"

# Check that function file exists
if [ ! -f "functions/record_vote.ts" ]; then
    echo "❌ FAIL: functions/record_vote.ts not found"
    exit 1
fi
echo "✅ Function file exists"

# Validate trigger type
if ! grep -q 'type: "event"' triggers/vote_button_trigger.ts; then
    echo "❌ FAIL: Trigger type is not 'event'"
    exit 1
fi
echo "✅ Trigger type is 'event'"

# Validate event type
if ! grep -q 'event_type: "slack#/events/block_actions"' triggers/vote_button_trigger.ts; then
    echo "❌ FAIL: Event type is not 'slack#/events/block_actions'"
    exit 1
fi
echo "✅ Event type is 'slack#/events/block_actions'"

# Validate action_ids
if ! grep -q '"vote_yes"' triggers/vote_button_trigger.ts; then
    echo "❌ FAIL: Missing action_id 'vote_yes'"
    exit 1
fi

if ! grep -q '"vote_no"' triggers/vote_button_trigger.ts; then
    echo "❌ FAIL: Missing action_id 'vote_no'"
    exit 1
fi

if ! grep -q '"vote_abstain"' triggers/vote_button_trigger.ts; then
    echo "❌ FAIL: Missing action_id 'vote_abstain'"
    exit 1
fi
echo "✅ All action_ids present (vote_yes, vote_no, vote_abstain)"

# Validate input mappings
required_inputs=("decision_id" "vote_type" "user_id" "channel_id" "message_ts")

for input in "${required_inputs[@]}"; do
    if ! grep -q "$input:" triggers/vote_button_trigger.ts; then
        echo "❌ FAIL: Missing input mapping for '$input'"
        exit 1
    fi
done
echo "✅ All required input mappings present"

# Validate workflow callback_id
if ! grep -q 'callback_id: "vote_workflow"' workflows/vote.ts; then
    echo "❌ FAIL: VoteWorkflow callback_id is not 'vote_workflow'"
    exit 1
fi
echo "✅ Workflow callback_id is correct"

# Validate workflow input parameters match trigger
for input in "${required_inputs[@]}"; do
    if ! grep -q "$input:" workflows/vote.ts; then
        echo "❌ FAIL: Workflow missing input parameter '$input'"
        exit 1
    fi
done
echo "✅ Workflow input parameters match trigger outputs"

# Validate function input parameters
for input in "${required_inputs[@]}"; do
    if ! grep -q "$input:" functions/record_vote.ts; then
        echo "❌ FAIL: Function missing input parameter '$input'"
        exit 1
    fi
done
echo "✅ Function input parameters match workflow"

# Validate button action_ids in create_decision
if ! grep -q 'action_id: "vote_yes"' functions/create_decision.ts; then
    echo "❌ FAIL: Missing button with action_id 'vote_yes' in create_decision"
    exit 1
fi

if ! grep -q 'action_id: "vote_no"' functions/create_decision.ts; then
    echo "❌ FAIL: Missing button with action_id 'vote_no' in create_decision"
    exit 1
fi

if ! grep -q 'action_id: "vote_abstain"' functions/create_decision.ts; then
    echo "❌ FAIL: Missing button with action_id 'vote_abstain' in create_decision"
    exit 1
fi
echo "✅ Voting buttons have matching action_ids"

# Validate VoteWorkflow is registered in manifest
if ! grep -q "VoteWorkflow" manifest.ts; then
    echo "❌ FAIL: VoteWorkflow not registered in manifest.ts"
    exit 1
fi
echo "✅ VoteWorkflow registered in manifest"

echo ""
echo "✅ All validations passed!"
echo ""
echo "Next steps:"
echo "1. Deploy the app: slack deploy"
echo "2. Install the trigger: slack triggers create --trigger-def triggers/vote_button_trigger.ts"
echo "3. Test voting: Create a decision and click a voting button"
echo ""
