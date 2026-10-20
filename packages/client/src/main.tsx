import { createRoot } from 'react-dom/client';
import { loadMenu, newGame } from './state/sim.ts';
import type { DepthPreset } from './worker/protocol.ts';
import { App } from './ui/App.tsx';
import './ui/styles.css';

// ?scenario= skips the start screen (handy for testing); ?side= and ?depth= go with it.
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario');
if (scenario) newGame(scenario, params.get('side'), (params.get('depth') as DepthPreset | null) ?? 'operational', {});
else loadMenu();
createRoot(document.getElementById('app')!).render(<App />);
