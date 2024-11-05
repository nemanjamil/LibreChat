// FollowUpQuestions.tsx
import { useRecoilValue } from 'recoil';
import store from '~/store';
import { useSubmitMessage } from '~/hooks';
import { Button, Separator } from '~/components/ui';
import { useChatFormContext } from '~/Providers';

function FollowUpQuestions({ index }: { index: number }) {
  const followUpQuestions = useRecoilValue(store.followUpQuestionsByIndex(index));
  const { submitPrompt } = useSubmitMessage();

  // Check if the ChatForm context is available, and log a warning if not
  try {
    useChatFormContext();
  } catch (error) {
    console.warn("FollowUpQuestions component requires a ChatFormProvider. Rendering skipped.");
    return null;
  }

  if (!followUpQuestions.length) return null;

  return (
    <div className="p-4 rounded-lg border border-gray-600 shadow-md bg-gray-900 text-white relative">
      <h3 className="text-lg font-semibold mb-2">Follow-up Questions</h3>
      <Separator className="mb-3 border-gray-700" />
      <ul className="space-y-4">
        {followUpQuestions.map((question, idx) => (
          <li key={idx}>
            <Button
              variant="ghost"
              className="w-full h-auto text-left text-gray-300 hover:bg-gray-800 px-3 py-2 rounded-lg"
              onClick={() => submitPrompt(question)}
            >
              <span className="block whitespace-normal">{question}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
  
}

export default FollowUpQuestions;
