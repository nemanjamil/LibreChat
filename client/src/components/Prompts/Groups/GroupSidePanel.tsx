import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import PanelNavigation from '~/components/Prompts/Groups/PanelNavigation';
import { useMediaQuery, usePromptGroupsNav } from '~/hooks';
import List from '~/components/Prompts/Groups/List';
import { cn } from '~/utils';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import FollowUpQuestions from './FollowUpQuestions';

export default function GroupSidePanel({
  children,
  isDetailView,
  className = '',
  /* usePromptGroupsNav */
  nextPage,
  prevPage,
  isFetching,
  hasNextPage,
  groupsQuery,
  promptGroups,
  hasPreviousPage,
}: {
  children?: React.ReactNode;
  isDetailView?: boolean;
  className?: string;
} & ReturnType<typeof usePromptGroupsNav>) {
  const location = useLocation();
  const isSmallerScreen = useMediaQuery('(max-width: 1024px)');
  const isChatRoute = useMemo(() => location.pathname.startsWith('/c/'), [location.pathname]);
  const activeChatIndex = useRecoilValue(store.activeChatIndexAtom); // Get the current active chat index

  return (
    <div
      className={cn(
        'mr-2 flex w-full min-w-72 flex-col gap-2 overflow-y-auto md:w-full lg:w-1/4 xl:w-1/4',
        isDetailView && isSmallerScreen ? 'hidden' : '',
        className,
      )}
    >
      {children}
      <div className="flex-grow overflow-y-auto">
        <List
          groups={promptGroups}
          isChatRoute={isChatRoute}
          isLoading={!!groupsQuery?.isLoading}
        />
      </div>
      <PanelNavigation
        nextPage={nextPage}
        prevPage={prevPage}
        isFetching={isFetching}
        hasNextPage={hasNextPage}
        isChatRoute={isChatRoute}
        hasPreviousPage={hasPreviousPage}
      />
      {/* Conditionally render FollowUpQuestions only if isChatRoute is true */}
      {isChatRoute && <FollowUpQuestions index={activeChatIndex} />}
    </div>
  );
}
