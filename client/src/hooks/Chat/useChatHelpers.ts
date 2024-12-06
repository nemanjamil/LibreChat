import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useResetRecoilState, useSetRecoilState } from 'recoil';
import { useGetMessagesByConvoId } from 'librechat-data-provider/react-query';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import { useAuthContext } from '~/hooks/AuthContext';
import useNewConvo from '~/hooks/useNewConvo';
import store from '~/store';

export default function useChatHelpers(index = 0, paramId?: string) {
  console.log('Initializing useChatHelpers with index:', index, 'paramId:', paramId);

  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(index));
  console.log('RecoilState - files:', files);

  const [filesLoading, setFilesLoading] = useState(false);
  console.log('State - filesLoading:', filesLoading);

  const queryClient = useQueryClient();
  console.log('QueryClient initialized.');

  const { isAuthenticated } = useAuthContext();
  console.log('AuthContext - isAuthenticated:', isAuthenticated);

  const { newConversation } = useNewConvo(index);
  console.log('useNewConvo - newConversation initialized.');

  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(index);
  console.log('Conversation Atom - conversation:', conversation);

  const { conversationId } = conversation ?? {};
  console.log('Conversation ID:', conversationId);

  const queryParam = paramId === 'new' ? paramId : conversationId ?? paramId ?? '';
  console.log('Query Parameter:', queryParam);

  const { data: _messages } = useGetMessagesByConvoId(conversationId ?? '', {
    enabled: isAuthenticated,
  });
  console.log('Fetched messages with useGetMessagesByConvoId:', _messages);

  const resetLatestMessage = useResetRecoilState(store.latestMessageFamily(index));
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(index));
  console.log('RecoilState - isSubmitting:', isSubmitting);

  const [latestMessage, setLatestMessage] = useRecoilState(store.latestMessageFamily(index));
  console.log('RecoilState - latestMessage:', latestMessage);

  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(latestMessage?.parentMessageId ?? null),
  );

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      console.log('Setting messages in queryClient:', messages);
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, queryParam], messages);
      if (queryParam === 'new') {
        queryClient.setQueryData<TMessage[]>([QueryKeys.messages, conversationId], messages);
      }
    },
    [queryParam, queryClient, conversationId],
  );

  const getMessages = useCallback(() => {
    console.log('Getting messages from queryClient.');
    return queryClient.getQueryData<TMessage[]>([QueryKeys.messages, queryParam]);
  }, [queryParam, queryClient]);

  const setSubmission = useSetRecoilState(store.submissionByIndex(index));
  console.log('SetSubmission initialized.');

  const { ask, regenerate } = useChatFunctions({
    index,
    files,
    setFiles,
    getMessages,
    setMessages,
    isSubmitting,
    conversation,
    latestMessage,
    setSubmission,
    setLatestMessage,
  });
  console.log('ChatFunctions initialized - ask and regenerate.');

  const continueGeneration = () => {
    console.log('Continuing generation.');
    if (!latestMessage) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();
    const parentMessage = messages?.find(
      (element) => element.messageId == latestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      console.log('Valid parent message found, continuing generation.');
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found, or not created by user.',
      );
    }
  };

  const stopGenerating = () => {
    console.log('Stopping generation.');
    clearAllSubmissions();
  };

  const handleStopGenerating = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    console.log('Stop generating button clicked.');
    stopGenerating();
  };

  const handleRegenerate = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    console.log('Regenerate button clicked.');
    const parentMessageId = latestMessage?.parentMessageId;
    if (!parentMessageId) {
      console.error('Failed to regenerate the message: parentMessageId not found.');
      return;
    }
    regenerate({ parentMessageId });
  };

  const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    console.log('Continue button clicked.');
    continueGeneration();
    setSiblingIdx(0);
  };

  const [showBingToneSetting, setShowBingToneSetting] = useRecoilState(
    store.showBingToneSettingFamily(index),
  );
  const [showPopover, setShowPopover] = useRecoilState(store.showPopoverFamily(index));
  const [abortScroll, setAbortScroll] = useRecoilState(store.abortScrollFamily(index));
  const [preset, setPreset] = useRecoilState(store.presetByIndex(index));
  const [optionSettings, setOptionSettings] = useRecoilState(store.optionSettingsFamily(index));
  const [showAgentSettings, setShowAgentSettings] = useRecoilState(
    store.showAgentSettingsFamily(index),
  );

  console.log('useChatHelpers setup complete.');

  return {
    newConversation,
    conversation,
    setConversation,
    isSubmitting,
    setIsSubmitting,
    getMessages,
    setMessages,
    setSiblingIdx,
    latestMessage,
    setLatestMessage,
    resetLatestMessage,
    conversationId,
    ask,
    index,
    regenerate,
    stopGenerating,
    handleStopGenerating,
    handleRegenerate,
    handleContinue,
    showPopover,
    setShowPopover,
    abortScroll,
    setAbortScroll,
    showBingToneSetting,
    setShowBingToneSetting,
    preset,
    setPreset,
    optionSettings,
    setOptionSettings,
    showAgentSettings,
    setShowAgentSettings,
    files,
    setFiles,
    filesLoading,
    setFilesLoading,
  };
}
