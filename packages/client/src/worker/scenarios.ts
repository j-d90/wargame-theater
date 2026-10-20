// Scenarios offered on the start screen, the main campaign first.
import { scenarioFiles } from '@tow/content';

export const scenarioIds: string[] = Object.keys(scenarioFiles).sort((a, b) => (a === 'desert-storm' ? -1 : b === 'desert-storm' ? 1 : a.localeCompare(b)));
