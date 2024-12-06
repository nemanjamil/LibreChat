const { klona } = require('klona');
const {
  StepTypes,
  RunStatus,
  StepStatus,
  ContentTypes,
  ToolCallTypes,
  imageGenTools,
  EModelEndpoint,
  defaultOrderQuery,
} = require('librechat-data-provider');
const { retrieveAndProcessFile } = require('~/server/services/Files/process');
const { processRequiredActions } = require('~/server/services/ToolService');
const { createOnProgress, sendMessage, sleep } = require('~/server/utils');
const { RunManager, waitForRun } = require('~/server/services/Runs');
const { processMessages } = require('~/server/services/Threads');
const { TextStream } = require('~/app/clients');
const { logger } = require('~/config');

/**
 * Sorts, processes, and flattens messages to a single string.
 *
 * @param {Object} params - Params for creating the onTextProgress function.
 * @param {OpenAIClient} params.openai - The OpenAI client instance.
 * @param {string} params.conversationId - The current conversation ID.
 * @param {string} params.userMessageId - The user message ID; response's `parentMessageId`.
 * @param {string} params.messageId - The response message ID.
 * @param {string} params.thread_id - The current thread ID.
 * @returns {void}
 */
async function createOnTextProgress({
  openai,
  conversationId,
  userMessageId,
  messageId,
  thread_id,
}) {
  openai.responseMessage = {
    conversationId,
    parentMessageId: userMessageId,
    role: 'assistant',
    messageId,
    content: [],
  };

  openai.responseText = '';

  openai.addContentData = (data) => {
    const { type, index } = data;
    openai.responseMessage.content[index] = { type, [type]: data[type] };

    if (type === ContentTypes.TEXT) {
      openai.responseText += data[type].value;
      return;
    }

    const contentData = {
      index,
      type,
      [type]: data[type],
      messageId,
      thread_id,
      conversationId,
    };

    logger.debug('Content data:', contentData);
    sendMessage(openai.res, contentData);
  };
}

/**
 * Retrieves the response from an OpenAI run.
 *
 * @param {Object} params - The parameters for getting the response.
 * @param {OpenAIClient} params.openai - The OpenAI client instance.
 * @param {string} params.run_id - The ID of the run to get the response for.
 * @param {string} params.thread_id - The ID of the thread associated with the run.
 * @return {Promise<OpenAIAssistantFinish | OpenAIAssistantAction[] | ThreadMessage[] | RequiredActionFunctionToolCall[]>}
 */
async function getResponse({ openai, run_id, thread_id }) {
  const run = await waitForRun({ openai, run_id, thread_id, pollIntervalMs: 2000 });

  if (run.status === RunStatus.COMPLETED) {
    const messages = await openai.beta.threads.messages.list(thread_id, defaultOrderQuery);
    const newMessages = messages.data.filter((msg) => msg.run_id === run_id);

    return newMessages;
  } else if (run.status === RunStatus.REQUIRES_ACTION) {
    const actions = [];
    // Skip processing tool_calls completely
if (run.required_action?.submit_tool_outputs?.tool_calls?.length) {
    logger.info('Skipping tool_calls processing');
}


    return actions;
  }

  const runInfo = JSON.stringify(run, null, 2);
  throw new Error(`Unexpected run status ${run.status}.\nFull run info:\n\n${runInfo}`);
}

/**
 * Filters the steps to keep only the most recent instance of each unique step.
 * @param {RunStep[]} steps - The array of RunSteps to filter.
 * @return {RunStep[]} The filtered array of RunSteps.
 */
function filterSteps(steps = []) {
  if (steps.length <= 1) {
    return steps;
  }
  const stepMap = new Map();

  steps.forEach((step) => {
    if (!step) {
      return;
    }

    const effectiveTimestamp = Math.max(
      step.created_at,
      step.expired_at || 0,
      step.cancelled_at || 0,
      step.failed_at || 0,
      step.completed_at || 0,
    );

    if (!stepMap.has(step.id) || effectiveTimestamp > stepMap.get(step.id).effectiveTimestamp) {
      const latestStep = { ...step, effectiveTimestamp };
      if (latestStep.last_error) {
        // testing to see if we ever step into this
      }
      stepMap.set(step.id, latestStep);
    }
  });

  return Array.from(stepMap.values()).map((step) => {
    delete step.effectiveTimestamp;
    return step;
  });
}

/**
 * @callback InProgressFunction
 * @param {Object} params - The parameters for the in progress step.
 * @param {RunStep} params.step - The step object with details about the message creation.
 * @returns {Promise<void>} - A promise that resolves when the step is processed.
 */

function hasToolCallChanged(previousCall, currentCall) {
  return JSON.stringify(previousCall) !== JSON.stringify(currentCall);
}

/**
 * Creates a handler function for steps in progress, specifically for
 * processing messages and managing seen completed messages.
 *
 * @param {OpenAIClient} openai - The OpenAI client instance.
 * @param {string} thread_id - The ID of the thread the run is in.
 * @param {ThreadMessage[]} messages - The accumulated messages for the run.
 * @return {InProgressFunction} a function to handle steps in progress.
 */
function createInProgressHandler(openai, thread_id, messages) {
  openai.index = 0;
  openai.mappedOrder = new Map();
  openai.completeToolCallSteps = new Set();

  async function in_progress({ step }) {
    if (step.type === StepTypes.MESSAGE_CREATION && step.status === StepStatus.COMPLETED) {
      const { message_id } = step.step_details.message_creation;

      const message = await openai.beta.threads.messages.retrieve(thread_id, message_id);
      if (!message?.content?.length) {
        return;
      }

      messages.push(message);

      const result = await processMessages({ openai, client: openai, messages: [message] });
      openai.addContentData({
        [ContentTypes.TEXT]: { value: result.text },
        type: ContentTypes.TEXT,
        index: openai.index++,
      });
    }
  }

  return in_progress;
}


/**
 * Initializes a RunManager with handlers, then invokes waitForRun to monitor and manage an OpenAI run.
 *
 * @param {Object} params - The parameters for managing and monitoring the run.
 * @param {OpenAIClient} params.openai - The OpenAI client instance.
 * @param {string} params.run_id - The ID of the run to manage and monitor.
 * @param {string} params.thread_id - The ID of the thread associated with the run.
 * @param {RunStep[]} params.accumulatedSteps - The accumulated steps for the run.
 * @param {ThreadMessage[]} params.accumulatedMessages - The accumulated messages for the run.
 * @param {InProgressFunction} [params.in_progress] - The `in_progress` function from a previous run.
 * @return {Promise<RunResponse>} A promise that resolves to an object containing the run and managed steps.
 */
async function runAssistant({
  openai,
  run_id,
  thread_id,
  accumulatedSteps = [],
  accumulatedMessages = [],
  in_progress: inProgress,
}) {
  let steps = accumulatedSteps;
  let messages = accumulatedMessages;
  const in_progress = inProgress ?? createInProgressHandler(openai, thread_id, messages);
  openai.in_progress = in_progress;

  const runManager = new RunManager({
    in_progress,
    final: async ({ step, runStatus, stepsByStatus }) => {
      logger.debug(`[runAssistant] Final step for ${run_id} with status ${runStatus}`, step);

      const promises = [];
      // promises.push(
      //   openai.beta.threads.messages.list(thread_id, defaultOrderQuery),
      // );

      // const finalSteps = stepsByStatus[runStatus];
      // for (const stepPromise of finalSteps) {
      //   promises.push(stepPromise);
      // }

      // loop across all statuses
      for (const [_status, stepsPromises] of Object.entries(stepsByStatus)) {
        promises.push(...stepsPromises);
      }

      const resolved = await Promise.all(promises);
      const finalSteps = filterSteps(steps.concat(resolved));

      if (step.type === StepTypes.MESSAGE_CREATION) {
        const incompleteToolCallSteps = finalSteps.filter(
          (s) => s && s.type === StepTypes.TOOL_CALLS && !openai.completeToolCallSteps.has(s.id),
        );
        for (const incompleteToolCallStep of incompleteToolCallSteps) {
          await in_progress({ step: incompleteToolCallStep });
        }
      }
      await in_progress({ step });
      // const res = resolved.shift();
      // messages = messages.concat(res.data.filter((msg) => msg && msg.run_id === run_id));
      resolved.push(step);
      /* Note: no issues without deep cloning, but it's safer to do so */
      steps = klona(finalSteps);
    },
  });

  const { endpoint = EModelEndpoint.azureAssistants } = openai.req.body;
  /** @type {TCustomConfig.endpoints.assistants} */
  const assistantsEndpointConfig = openai.req.app.locals?.[endpoint] ?? {};
  const { pollIntervalMs, timeoutMs } = assistantsEndpointConfig;

  const run = await waitForRun({
    openai,
    run_id,
    thread_id,
    runManager,
    pollIntervalMs,
    timeout: timeoutMs,
  });

  if (!run.required_action) {
    // const { messages: sortedMessages, text } = await processMessages(openai, messages);
    // return { run, steps, messages: sortedMessages, text };
    const sortedMessages = messages.sort((a, b) => a.created_at - b.created_at);
    return {
      run,
      steps,
      messages: sortedMessages,
      finalMessage: openai.responseMessage,
      text: openai.responseText,
    };
  }

  const { submit_tool_outputs } = run.required_action;
  const actions = submit_tool_outputs.tool_calls.map((item) => {
    const functionCall = item.function;
    const args = JSON.parse(functionCall.arguments);
    return {
      tool: functionCall.name,
      toolInput: args,
      toolCallId: item.id,
      run_id,
      thread_id,
    };
  });

  const outputs = await processRequiredActions(openai, actions);

  const toolRun = await openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, outputs);

  // Recursive call with accumulated steps and messages
  return await runAssistant({
    openai,
    run_id: toolRun.id,
    thread_id,
    accumulatedSteps: steps,
    accumulatedMessages: messages,
    in_progress,
  });
}

module.exports = {
  getResponse,
  runAssistant,
  createOnTextProgress,
};
