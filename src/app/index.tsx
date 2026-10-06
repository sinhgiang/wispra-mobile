import { Redirect } from 'expo-router';

// The app opens on the Dictate tab
export default function Index() {
  return <Redirect href="/dictate" />;
}
