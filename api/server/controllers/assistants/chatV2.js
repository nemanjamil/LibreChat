const { v4 } = require('uuid');
const {
  Time,
  Constants,
  RunStatus,
  CacheKeys,
  ContentTypes,
  ToolCallTypes,
  EModelEndpoint,
  retrievalMimeTypes,
  AssistantStreamEvents,
} = require('librechat-data-provider');
const {
  initThread,
  recordUsage,
  saveUserMessage,
  addThreadMetadata,
  saveAssistantMessage,
} = require('~/server/services/Threads');
const { runAssistant, createOnTextProgress } = require('~/server/services/AssistantService');
const { sendMessage, sleep, isEnabled, countTokens } = require('~/server/utils');
const { createErrorHandler } = require('~/server/controllers/assistants/errors');
const validateAuthor = require('~/server/middleware/assistants/validateAuthor');
const { createRun, StreamRunManager } = require('~/server/services/Runs');
const { addTitle } = require('~/server/services/Endpoints/assistants');
const { getTransactions } = require('~/models/Transaction');
const checkBalance = require('~/models/checkBalance');
const { getConvo } = require('~/models/Conversation');
const getLogStores = require('~/cache/getLogStores');
const { getModelMaxTokens } = require('~/utils');
const { getOpenAIClient } = require('./helpers');
const { logger } = require('~/config');
const axios = require('axios');
const ten_minutes = 1000 * 60 * 10;
const createContextHandlers = require('~/app/clients/prompts/createContextHandlers');
/**
 * @route POST /
 * @desc Chat with an assistant
 * @access Public
 * @param {Express.Request} req - The request object, containing the request data.
 * @param {Express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
const chatV2 = async (req, res) => {
  logger.debug('[/assistants/chat/] req.body', req.body);

  /** @type {{files: MongoFile[]}} */
  const {
    text,
    model,
    endpoint,
    files = [],
    promptPrefix,
    assistant_id,
    instructions,
    endpointOption,
    thread_id: _thread_id,
    messageId: _messageId,
    conversationId: convoId,
    parentMessageId: _parentId = Constants.NO_PARENT,
  } = req.body;
  logger.debug('Destructured assistant_id:', assistant_id);

  /** @type {OpenAIClient} */
  let openai;
  /** @type {string|undefined} - the current thread id */
  let thread_id = _thread_id;
  /** @type {string|undefined} - the current run id */
  let run_id;
  /** @type {string|undefined} - the parent messageId */
  let parentMessageId = _parentId;
  /** @type {TMessage[]} */
  let previousMessages = [];
  /** @type {import('librechat-data-provider').TConversation | null} */
  let conversation = null;
  /** @type {string[]} */
  let file_ids = [];
  /** @type {Set<string>} */
  let attachedFileIds = new Set();
  /** @type {TMessage | null} */
  let requestMessage = null;

  const userMessageId = v4();
  const responseMessageId = v4();

  /** @type {string} - The conversation UUID - created if undefined */
  const conversationId = convoId ?? v4();

  const cache = getLogStores(CacheKeys.ABORT_KEYS);
  const cacheKey = `${req.user.id}:${conversationId}`;

  /** @type {Run | undefined} - The completed run, undefined if incomplete */
  let completedRun;

  const getContext = () => ({
    openai,
    run_id,
    endpoint,
    cacheKey,
    thread_id,
    completedRun,
    assistant_id,
    conversationId,
    parentMessageId,
    responseMessageId,
  });

  const handleError = createErrorHandler({ req, res, getContext });
  const jwtToken = req.headers.authorization.split(' ')[1];
  const { processAllFiles, createContext } = createContextHandlers(req, text);

  
  
  
  
  

  try {
    res.on('close', async () => {
      if (!completedRun) {
        await handleError(new Error('Request closed'));
      }
    });

    if (convoId && !_thread_id) {
      completedRun = true;
      throw new Error('Missing thread_id for existing conversation');
    }
    logger.info('assistant_id before initializeThread:', assistant_id);

    if (!assistant_id) {
      completedRun = true;
      throw new Error('Missing assistant_id');
    }

    const checkBalanceBeforeRun = async () => {
      if (!isEnabled(process.env.CHECK_BALANCE)) {
        return;
      }
      const transactions =
        (await getTransactions({
          user: req.user.id,
          context: 'message',
          conversationId,
        })) ?? [];

      const totalPreviousTokens = Math.abs(
        transactions.reduce((acc, curr) => acc + curr.rawAmount, 0),
      );

      // TODO: make promptBuffer a config option; buffer for titles, needs buffer for system instructions
      const promptBuffer = parentMessageId === Constants.NO_PARENT && !_thread_id ? 200 : 0;
      // 5 is added for labels
      let promptTokens = (await countTokens(text + (promptPrefix ?? ''))) + 5;
      promptTokens += totalPreviousTokens + promptBuffer;
      // Count tokens up to the current context window
      promptTokens = Math.min(promptTokens, getModelMaxTokens(model));

      await checkBalance({
        req,
        res,
        txData: {
          model,
          user: req.user.id,
          tokenType: 'prompt',
          amount: promptTokens,
        },
      });
    };

    const { openai: _openai, client } = await getOpenAIClient({
      req,
      res,
      endpointOption,
      initAppClient: true,
    });

    openai = _openai;
    await validateAuthor({ req, openai });

    if (previousMessages.length) {
      parentMessageId = previousMessages[previousMessages.length - 1].messageId;
    }

    let userMessage = {
      role: 'user',
      content: [
        {
          type: ContentTypes.TEXT,
          text,
        },
      ],
      metadata: {
        messageId: userMessageId,
      },
    };

    /** @type {CreateRunBody | undefined} */
    const body = {
      assistant_id: assistant_id || req.body.assistant_id, // Fallback to ensure assistant_id
      model,
    };
    logger.info('Body after creation:', body);

    if (promptPrefix) {
      body.additional_instructions = promptPrefix;
    }

    if (typeof endpointOption.artifactsPrompt === 'string' && endpointOption.artifactsPrompt) {
      body.additional_instructions = `${body.additional_instructions ?? ''}\n${endpointOption.artifactsPrompt}`.trim();
    }

    if (instructions) {
      body.instructions = instructions;
    }

    

    /** @type {Promise<Run>|undefined} */
    let userMessagePromise;

    const initializeThread = async () => {
      logger.info('Initializing thread...');
      logger.debug('qweassistant_id', assistant_id)
      logger.info('qweassistant_id', assistant_id)

      try {
        if (!assistant_id) {
          const errorMsg = 'Missing assistant_id';
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
    
        logger.info('Processing files for assistant:', assistant_id);
        fileContext = await processAllFiles(assistant_id);
    
        logger.info('Files processed successfully.');
    
        // Use fileContext.content if it exists
        const enrichedText = fileContext && fileContext.content
          ? `Context:\n${fileContext.content}\n\nUser Query:\n${text}`
          : text;
    
        logger.debug(`Enriched text prepared: ${enrichedText}`);
  
          // Initialize thread body
          const initThreadBody = {
              messages: [
                  {
                      role: 'user',
                      content: [
                          {
                              type: ContentTypes.TEXT,
                              text: enrichedText,
                          },
                      ],
                      metadata: {
                          messageId: userMessageId,
                      },
                  },
              ],
              metadata: {
                  user: req.user.id,
                  conversationId,
              },
          };
  
          logger.info('Initializing thread with OpenAI API...');
          const result = await initThread({ openai, body: initThreadBody, thread_id });
          thread_id = result.thread_id;
          logger.info(`Thread initialized successfully: thread_id=${thread_id}`);
  
          // Track progress
          logger.info('Creating text progress tracking...');
          createOnTextProgress({
              openai,
              conversationId,
              userMessageId,
              messageId: responseMessageId,
              thread_id,
          });
  
          // Save user message
           requestMessage = {
              user: req.user.id,
              text: text,
              messageId: userMessageId,
              parentMessageId,
              conversationId,
              isCreatedByUser: true,
              assistant_id,
              thread_id,
              model: assistant_id,
              endpoint,
          };
          logger.info(`User message created: ${JSON.stringify(requestMessage)}`);
          logger.debug("Assitant id reqmesssage" , assistant_id)
          logger.info("Assitant id reqmesssage" , requestMessage.assistant_id)

          previousMessages.push(requestMessage);
  
          userMessagePromise = saveUserMessage(req, { ...requestMessage, model });
          logger.info('User message saved successfully.');
  
          // Update conversation metadata
          const conversation = {
              conversationId,
              endpoint,
              promptPrefix,
              instructions,
              assistant_id,
          };
          logger.info('Conversation metadata updated.');
      } catch (error) {
          logger.error('Error initializing thread:', error);
          throw error;
      }
  };
  

  
  
  // Concurrent promises
  logger.info('Starting thread initialization and balance check...');
  const promises = [initializeThread(), checkBalanceBeforeRun()];
  await Promise.all(promises)
      .then(() => {
          logger.info('Thread initialized and balance check completed successfully.');
      })
      .catch((error) => {
          logger.error('Error during thread initialization or balance check:', error);
          throw error;
      });
  
  // Send initial response
  const sendInitialResponse = () => {
      logger.info('Sending initial response to the client...');
      sendMessage(res, {
          sync: true,
          conversationId,
          requestMessage,
          responseMessage: {
              user: req.user.id,
              messageId: openai.responseMessage.messageId,
              parentMessageId: userMessageId,
              conversationId,
              assistant_id,
              thread_id,
              model: assistant_id,
          },
      });
  };
  
    /** @type {RunResponse | typeof StreamRunManager | undefined} */
    let response;

    const processRun = async (retry = false) => {
      if (endpoint === EModelEndpoint.azureAssistants) {
        body.model = openai._options.model;
        openai.attachedFileIds = attachedFileIds;
        if (retry) {
          response = await runAssistant({
            openai,
            thread_id,
            run_id,
            in_progress: openai.in_progress,
          });
          return;
        }

        /* NOTE:
         * By default, a Run will use the model and tools configuration specified in Assistant object,
         * but you can override most of these when creating the Run for added flexibility:
         */
        const run = await createRun({
          openai,
          thread_id,
          body,
        });

        run_id = run.id;
        await cache.set(cacheKey, `${thread_id}:${run_id}`, ten_minutes);
        sendInitialResponse();

        // todo: retry logic
        response = await runAssistant({ openai, thread_id, run_id });
        return;
      }

      /** @type {{[AssistantStreamEvents.ThreadRunCreated]: (event: ThreadRunCreated) => Promise<void>}} */
      const handlers = {
        [AssistantStreamEvents.ThreadRunCreated]: async (event) => {
          await cache.set(cacheKey, `${thread_id}:${event.data.id}`, ten_minutes);
          run_id = event.data.id;
          sendInitialResponse();
        },
      };

      /** @type {undefined | TAssistantEndpoint} */
      const config = req.app.locals[endpoint] ?? {};
      /** @type {undefined | TBaseEndpoint} */
      const allConfig = req.app.locals.all;

      const streamRunManager = new StreamRunManager({
        req,
        res,
        openai,
        handlers,
        thread_id,
        attachedFileIds,
        parentMessageId: userMessageId,
        responseMessage: openai.responseMessage,
        streamRate: allConfig?.streamRate ?? config.streamRate,
        // streamOptions: {

        // },
      });

      await streamRunManager.runAssistant({
        thread_id,
        body,
      });

      response = streamRunManager;
      response.text = streamRunManager.intermediateText;
      
      const messageCache = getLogStores(CacheKeys.MESSAGES);
      messageCache.set(
        responseMessageId,
        {
          complete: true,
          text: response.text,
        },
        Time.FIVE_MINUTES,
      );
    };

    await processRun();
    logger.debug('[/assistants/chat/] response', {
      run: response.run,
      steps: response.steps,
    });

    if (response.run.status === RunStatus.CANCELLED) {
      logger.debug('[/assistants/chat/] Run cancelled, handled by `abortRun`');
      return res.end();
    }

    if (response.run.status === RunStatus.IN_PROGRESS) {
      processRun(true);
    }

    completedRun = response.run;

    /** @type {ResponseMessage} */
    const responseMessage = {
      ...(response.responseMessage ?? response.finalMessage),
      text: response.text,
      parentMessageId: userMessageId,
      conversationId,
      user: req.user.id,
      assistant_id,
      thread_id,
      model: assistant_id,
      endpoint,
    };

    sendMessage(res, {
      final: true,
      conversation,
      requestMessage: {
        parentMessageId,
        thread_id,
      },
    });
    res.end();

    if (userMessagePromise) {
      await userMessagePromise;
    }
    await saveAssistantMessage(req, { ...responseMessage, model });

    if (parentMessageId === Constants.NO_PARENT && !_thread_id) {
      addTitle(req, {
        text,
        responseText: response.text,
        conversationId,
        client,
      });
    }

    await addThreadMetadata({
      openai,
      thread_id,
      messageId: responseMessage.messageId,
      messages: response.messages,
    });

    if (!response.run.usage) {
      await sleep(3000);
      completedRun = await openai.beta.threads.runs.retrieve(thread_id, response.run.id);
      if (completedRun.usage) {
        await recordUsage({
          ...completedRun.usage,
          user: req.user.id,
          model: completedRun.model ?? model,
          conversationId,
        });
      }
    } else {
      await recordUsage({
        ...response.run.usage,
        user: req.user.id,
        model: response.run.model ?? model,
        conversationId,
      });
    }
  } catch (error) {
    await handleError(error);
  }
};

module.exports = chatV2;
