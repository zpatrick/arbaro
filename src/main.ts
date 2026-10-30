import './style.css';
import { mountGameView } from './gameView';
import { LEVELS, type LevelDef } from './levels';
import { mountLevelSelect, mountMainMenu } from './screens';
import { invariant } from './util';

function findHost(): HTMLElement {
  const found = document.getElementById('app');
  invariant(found !== null, 'Missing #app element.');
  return found;
}

const host = findHost();

let current: { destroy(): void } | undefined;

function replace(next: { destroy(): void }): void {
  current?.destroy();
  current = next;
}

function showMainMenu(): void {
  replace(mountMainMenu(host, showLevelSelect));
}

function showLevelSelect(): void {
  replace(mountLevelSelect(host, LEVELS, startLevel, showMainMenu));
}

function startLevel(level: LevelDef): void {
  replace(
    mountGameView(host, level, {
      onExit: showLevelSelect,
      onRestart: () => startLevel(level),
    }),
  );
}

showMainMenu();
