import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { useGetMessagesByConvoId } from 'librechat-data-provider/react-query';
import type { ChatFormValues } from '~/common';
import { ChatContext, AddedChatContext, useFileMapContext, ChatFormProvider } from '~/Providers';
import { useChatHelpers, useAddedResponse, useSSE } from '~/hooks';
import MessagesView from './Messages/MessagesView';
import { Spinner } from '~/components/svg';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import { buildTree } from '~/utils';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import store from '~/store';

function ChatView({ index = 0 }: { index?: number }) {
  console.log('Rendering ChatView with index:', index);

  const { conversationId } = useParams();
  console.log('useParams - conversationId:', conversationId);

  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  console.log('useRecoilValue - rootSubmission:', rootSubmission);

  const addedSubmission = useRecoilValue(store.submissionByIndex(index + 1));
  console.log('useRecoilValue - addedSubmission:', addedSubmission);

  const fileMap = useFileMapContext();
  console.log('useFileMapContext - fileMap:', fileMap);

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: (data) => {
      console.log('Processing data in select:', data);
      const dataTree = buildTree({ messages: data, fileMap });
      console.log('Data processed into tree structure:', dataTree);
      return dataTree?.length === 0 ? null : dataTree ?? null;
    },
    enabled: !!fileMap,
  });
  console.log('useGetMessagesByConvoId - messagesTree:', messagesTree, 'isLoading:', isLoading);

  const chatHelpers = useChatHelpers(index, conversationId);
  console.log('useChatHelpers - chatHelpers:', chatHelpers);

  const addedChatHelpers = useAddedResponse({ rootIndex: index });
  console.log('useAddedResponse - addedChatHelpers:', addedChatHelpers);

  useSSE(rootSubmission, chatHelpers, false);
  console.log('useSSE initialized for rootSubmission with chatHelpers.');

  useSSE(addedSubmission, addedChatHelpers, true);
  console.log('useSSE initialized for addedSubmission with addedChatHelpers.');

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });
  console.log('useForm initialized with default values.');

  let content: JSX.Element | null | undefined;
  if (isLoading && conversationId !== 'new') {
    console.log('Content is loading...');
    content = (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="opacity-0" />
      </div>
    );
  } else if (messagesTree && messagesTree.length !== 0) {
    console.log('MessagesTree has data, rendering MessagesView.');
    content = <MessagesView messagesTree={messagesTree} Header={<Header />} />;
  } else {
    console.log('MessagesTree is empty or null, rendering Landing.');
    content = <Landing Header={<Header />} />;
  }

  console.log('Rendering ChatView content.');
  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation useSidePanel={true}>
            {content}
            <div className="w-full border-t-0 pl-0 pt-2 dark:border-white/20 md:w-[calc(100%-.5rem)] md:border-t-0 md:border-transparent md:pl-0 md:pt-0 md:dark:border-transparent">
              <ChatForm index={index} />
              <Footer />
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
