import {createContext} from 'react';

// Covered pages stay mounted for back transitions and scroll restoration.
// Only the foreground page may retain focus or expose interactive controls.
export const PageActivityContext = createContext(true);
