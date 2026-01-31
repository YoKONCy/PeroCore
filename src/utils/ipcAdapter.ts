// src/utils/ipcAdapter.ts

declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
    };
  }
}

const isElectron = () => !!window.electron;

export const invoke = async (cmd: string, args?: any) => {
  if (isElectron()) {
    return window.electron!.invoke(cmd, args);
  }

  // Browser Fallback (Docker Mode)
  // console.log(`[IPC Adapter] Browser Mode: Mocking invoke '${cmd}'`, args);

  switch (cmd) {
    case 'get_gateway_token':
      // Fetch from backend API
      try {
        const res = await fetch('/api/gateway/token');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.token;
      } catch (e) {
        console.error('[IPC Adapter] Failed to fetch gateway token:', e);
        return null;
      }
    
    // Window Management (No-op)
    case 'window-minimize':
    case 'window-maximize':
    case 'window-close':
    case 'window-is-maximized':
    case 'window-drag-start':
    case 'window-drag-end':
    case 'set_ignore_mouse':
    case 'open_ide_window':
    case 'show_window':
    case 'hide_pet_window':
    case 'resize-pet-window':
      return Promise.resolve();

    default:
      console.warn(`[IPC Adapter] Unknown command in Browser Mode: ${cmd}`);
      return Promise.resolve(null);
  }
}

export const listen = async (event: string, handler: (payload: any) => void) => {
  if (isElectron()) {
    return window.electron!.on(event, (_e: any, ...args: any[]) => handler(args[0]));
  }

  console.warn(`[IPC Adapter] Browser Mode: Listening to '${event}' is not fully supported yet.`);
  return () => {};
}

export const emit = async (event: string, payload?: any) => {
  if (isElectron()) {
    return window.electron!.invoke('emit_event', { event, payload });
  }
  console.log(`[IPC Adapter] Browser Mode: Emit '${event}'`, payload);
}
