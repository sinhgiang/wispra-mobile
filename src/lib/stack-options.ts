import { W } from '@/constants/wispra';

// Options of every screen in the stack. iOS 26 lets a drag from anywhere on a screen take it back to
// the one before (the system's full-screen back swipe), and a finger dragging the Recording bar or the
// mind map was taken for it: the whole screen slid away (T-0178, build 5). Off here, so only the swipe
// from the left edge goes back, and a drag inside a screen stays with what is under the finger.
export const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: W.bg },
  fullScreenGestureEnabled: false,
};
