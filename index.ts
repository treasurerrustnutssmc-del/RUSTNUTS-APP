import { registerRootComponent } from 'expo';

import App from './App';
// Lane E: live ride. Defines the background location task before the phone can wake it.
import './src/data/liveTracker';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
