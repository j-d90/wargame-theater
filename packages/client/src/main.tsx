import { createRoot } from 'react-dom/client';
import { sim } from './state/sim.ts';
import { App } from './ui/App.tsx';
import './ui/styles.css';

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'gulf-sandbox';
sim.load(scenario);
createRoot(document.getElementById('app')!).render(<App />);
