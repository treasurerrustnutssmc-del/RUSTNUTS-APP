import { registerRootComponent } from 'expo';

import App from './App';
// Lane E: live ride. Defines the background location task before the phone can wake it.
import './src/data/liveTracker';
// Notifications that arrive while the app is open: the club's banner and the bike (set up before any can arrive).
import './src/data/foregroundNotifications';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
