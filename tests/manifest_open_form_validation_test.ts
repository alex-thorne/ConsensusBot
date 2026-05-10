import manifest from "../manifest.ts";

const OPEN_FORM_FUNCTION_ID = "slack#/functions/open_form";
const UNSUPPORTED_STRING_FIELD_PROPERTIES = [
  "max_length",
  "min_length",
] as const;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    message,
  );
  return value as Record<string, unknown>;
}

function asArray(value: unknown, message: string): unknown[] {
  assert(Array.isArray(value), message);
  return value;
}

Deno.test("OpenForm string fields avoid unsupported manifest properties", () => {
  const manifestRecord = asRecord(manifest, "manifest must be an object");
  const workflows = asRecord(
    manifestRecord.workflows,
    "manifest.workflows must be an object",
  );

  for (const [workflowId, workflow] of Object.entries(workflows)) {
    const workflowRecord = asRecord(workflow, "workflow must be an object");
    const steps = asArray(
      workflowRecord.steps,
      `workflow ${workflowId} must define steps`,
    );

    for (const step of steps) {
      const stepRecord = asRecord(
        step,
        `workflow ${workflowId} step must be an object`,
      );
      if (stepRecord.function_id !== OPEN_FORM_FUNCTION_ID) {
        continue;
      }

      const inputs = asRecord(
        stepRecord.inputs,
        `OpenForm step in ${workflowId} must define inputs`,
      );
      const fields = asRecord(
        inputs.fields,
        `OpenForm step in ${workflowId} must define fields`,
      );
      const elements = asArray(
        fields.elements,
        `OpenForm step in ${workflowId} must define fields.elements`,
      );

      for (const element of elements) {
        const elementRecord = asRecord(
          element,
          `OpenForm field in ${workflowId} must be an object`,
        );
        if (elementRecord.type !== "string") {
          continue;
        }

        const fieldName = typeof elementRecord.name === "string"
          ? elementRecord.name
          : "<unnamed>";

        for (const property of UNSUPPORTED_STRING_FIELD_PROPERTIES) {
          assert(
            !(property in elementRecord),
            `OpenForm string field "${fieldName}" in workflow "${workflowId}" contains unsupported property "${property}"`,
          );
        }
      }
    }
  }
});
