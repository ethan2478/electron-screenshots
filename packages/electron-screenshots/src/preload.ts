/* eslint-disable no-console */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { Display } from './getDisplay';

type IpcRendererListener = (
  event: IpcRendererEvent,
  ...args: unknown[]
) => void;
type ScreenshotsListener = (...args: unknown[]) => void;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotsData {
  bounds: Bounds;
  display: Display;
}

function getDisplayId(): number | null {
  const arg = process.argv.find((_arg) => _arg.startsWith('--display-id='));
  if (!arg) return null;
  return Number(arg.split('=')[1]);
}

const displayId = getDisplayId();

const map = new Map<ScreenshotsListener, Record<string, IpcRendererListener>>();

contextBridge.exposeInMainWorld('screenshots', {
  displayId,
  ready: () => {
    console.log('contextBridge ready', displayId);

    ipcRenderer.send('SCREENSHOTS:ready', displayId);
  },
  activate: () => {
    console.log('contextBridge activate', displayId);
    ipcRenderer.send('SCREENSHOTS:activate', displayId);
  },
  // reset: () => {
  //   console.log('contextBridge reset');

  //   ipcRenderer.send('SCREENSHOTS:reset');
  // },
  save: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => {
    console.log('contextBridge save', arrayBuffer.byteLength, data.display);

    ipcRenderer.send(
      'SCREENSHOTS:save',
      displayId,
      Buffer.from(arrayBuffer),
      data,
    );
  },
  cancel: () => {
    console.log('contextBridge cancel');

    ipcRenderer.send('SCREENSHOTS:cancel');
  },
  ok: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => {
    console.log('contextBridge ok', arrayBuffer.byteLength, data.display);

    ipcRenderer.send('SCREENSHOTS:ok', Buffer.from(arrayBuffer), data);
  },
  on: (channel: string, fn: ScreenshotsListener) => {
    console.log('contextBridge on', fn);

    const listener = (event: IpcRendererEvent, ...args: unknown[]) => {
      console.log('contextBridge on', channel);
      fn(...args);
    };

    const listeners = map.get(fn) ?? {};
    listeners[channel] = listener;
    map.set(fn, listeners);

    ipcRenderer.on(`SCREENSHOTS:${channel}`, listener);
  },
  off: (channel: string, fn: ScreenshotsListener) => {
    console.log('contextBridge off', fn);

    const listeners = map.get(fn) ?? {};
    const listener = listeners[channel];
    delete listeners[channel];

    if (!listener) {
      return;
    }

    ipcRenderer.off(`SCREENSHOTS:${channel}`, listener);
  },
});
