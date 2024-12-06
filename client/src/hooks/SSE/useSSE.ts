import { v4 } from 'uuid';
import { useSetRecoilState } from 'recoil';
import { useEffect, useState } from 'react';
import {
  /* @ts-ignore */
  SSE,
  createPayload,
  isAgentsEndpoint,
  removeNullishValues,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import { useGetUserBalance, useGetStartupConfig } from 'librechat-data-provider/react-query';
import type { TMessage, TSubmission, TPayload, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { TResData } from '~/common';
import { useGenTitleMutation } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import store from '~/store';

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
>;

export default function useSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const genTitle = useGenTitleMutation();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();
  const [completed, setCompleted] = useState(new Set());
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    stepHandler,
    syncHandler,
    finalHandler,
    errorHandler,
    messageHandler,
    contentHandler,
    createdHandler,
    attachmentHandler,
    abortConversation,
  } = useEventHandlers({
    genTitle,
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.checkBalance,
  });

  useEffect(() => {
    console.log('useSSE submission:', submission);

    if (submission === null || Object.keys(submission).length === 0) {
        console.log('Submission is null or empty, exiting effect.');
        return;
    }


    let { userMessage } = submission;

    console.log('Creating payload from submission.');
    const payloadData = createPayload(submission);
    let { payload } = payloadData;
    console.log('Payload created:', payload);

    if (isAssistantsEndpoint(payload.endpoint) || isAgentsEndpoint(payload.endpoint)) {
        console.log('Endpoint requires removing nullish values.');
        payload = removeNullishValues(payload) as TPayload;
        console.log('Payload after removing nullish values:', payload);
    }

    let textIndex = null;

    console.log('Initializing SSE with payloadData.server:', payloadData.server);
    const events = new SSE(payloadData.server, {
        payload: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    events.onattachment = (e: MessageEvent) => {
        console.log('Attachment event received:', e.data);
        try {
            const data = JSON.parse(e.data);
            attachmentHandler({ data, submission: submission as EventSubmission });
        } catch (error) {
            console.error('Error handling attachment event:', error);
        }
    };

    events.onmessage = (e: MessageEvent) => {
        console.log('Raw SSE data:', e.data);
        const data = JSON.parse(e.data);
        console.log('Parsed SSE data:', data);
        console.log('Before finalHandler - conversation:', data.conversation);

        if (data.final != null) {
            console.log('Final event detected:', data);
            const { plugins } = data;
            finalHandler(data, { ...submission, plugins } as EventSubmission);
            if (startupConfig?.checkBalance ?? false) {
                balanceQuery.refetch();
            }
            return;
        } else if (data.created != null) {
            console.log('Created event detected:', data);
            const runId = v4();
            setActiveRunId(runId);
            userMessage = {
                ...userMessage,
                ...data.message,
                overrideParentMessageId: userMessage.overrideParentMessageId,
            };
            createdHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.event != null) {
            console.log('Step event detected:', data);
            stepHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.sync != null) {
            console.log('Sync event detected:', data);
            const runId = v4();
            setActiveRunId(runId);
            syncHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.type != null) {
            console.log('Type event detected:', data);
            const { text, index } = data;
            if (text != null && index !== textIndex) {
                textIndex = index;
            }
            contentHandler({ data, submission: submission as EventSubmission });
        } else {
            console.log('Default message handling for data:', data);
            const text = data.text ?? data.response;
            const { plugin, plugins } = data;
            const initialResponse = {
                ...(submission.initialResponse as TMessage),
                parentMessageId: data.parentMessageId,
                messageId: data.messageId,
            };
            if (data.message != null) {
                messageHandler(text, { ...submission, plugin, plugins, userMessage, initialResponse });
            }
        }
    };

    events.onopen = () => {
        console.log('SSE connection opened.');
        setAbortScroll(false);
    };

    events.oncancel = async () => {
        console.log('Cancel event triggered.');
        const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
        if (completed.has(streamKey)) {
            console.log('Submission already completed.');
            setIsSubmitting(false);
            setCompleted((prev) => {
                prev.delete(streamKey);
                return new Set(prev);
            });
            return;
        }
        console.log('Marking submission as completed.');
        setCompleted((prev) => new Set(prev.add(streamKey)));
        const latestMessages = getMessages();
        const conversationId = latestMessages?.[latestMessages.length - 1]?.conversationId;
        return await abortConversation(
            conversationId ?? userMessage.conversationId ?? submission.conversationId,
            submission as EventSubmission,
            latestMessages,
        );
    };

    events.onerror = function (e: MessageEvent) {
        console.log('Error event triggered in SSE.');
        if (startupConfig?.checkBalance ?? false) {
            balanceQuery.refetch();
        }
        let data: TResData | undefined = undefined;
        try {
            data = JSON.parse(e.data) as TResData;
        } catch (error) {
            console.error('Error parsing error event data:', error);
            console.log('Event data:', e);
            setIsSubmitting(false);
        }
        errorHandler({ data, submission: { ...submission, userMessage } as EventSubmission });
    };

    console.log('Setting isSubmitting to true and starting SSE stream.');
    setIsSubmitting(true);
    events.stream();

    return () => {
        console.log('Cleaning up SSE connection.');
        const isCancelled = events.readyState <= 1;
        events.close();
        if (isCancelled) {
            const e = new Event('cancel');
            console.log('Dispatching cancel event.');
            events.dispatchEvent(e);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [submission]);
}
