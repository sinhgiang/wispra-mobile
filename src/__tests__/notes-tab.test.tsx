// The bottom bar (T-0979): Notes is a tab of its own, between Meetings and History, and goes to the
// Notes screen. The bar is rendered; only the router's tab components are stand-ins that pass their
// props on.
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router/ui', () => {
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const { cloneElement } = jest.requireActual('react') as typeof import('react');
  return {
    Tabs: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    TabSlot: () => null,
    TabList: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    TabTrigger: ({ children, name, href }: { children: ReactElement; name: string; href: string }) =>
      cloneElement(children, { testID: `tab-${name}`, accessibilityHint: href } as never),
  };
});

// eslint-disable-next-line import/first
import WispraTabs from '@/app/(tabs)/_layout';

describe('the bottom bar', () => {
  it('has five tabs, Notes between Meetings and History, going to /notes', async () => {
    await render(<WispraTabs />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.testID)).toEqual(['tab-dictate', 'tab-meetings', 'tab-notes', 'tab-history', 'tab-account']);
    expect(screen.getByTestId('tab-notes').props.accessibilityHint).toBe('/notes');
    expect(screen.getByText('Notes')).toBeTruthy();
  });
});
