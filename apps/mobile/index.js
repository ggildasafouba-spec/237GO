import 'react-native-gesture-handler';
// En premier : rend les alertes visibles sur la version web (vides par défaut dans react-native-web)
import './src/utils/webAlert';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
