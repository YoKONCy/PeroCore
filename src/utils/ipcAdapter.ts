// Only support Electron environment
// 仅支持 Electron 环境

// Define Window interface to include electron
// 定义 Window 接口以包含 electron
declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
    };
  }
}

export const invoke = async (cmd: string, args?: any) => {
  if (window.electron) {
    return window.electron.invoke(cmd, args);
  }
  
  console.warn(`[IPC] No backend found for command: ${cmd}`);
  return Promise.reject("No backend found");
}

export const listen = async (event: string, handler: (payload: any) => void) => {
  if (window.electron) {
    // Electron's on method returns a cleanup function
    // Electron 的 on 方法返回一个清理函数
    return window.electron.on(event, (_e: any, ...args: any[]) => handler(args[0]));
  }

  console.warn(`[IPC] No backend found for event: ${event}`);
  return () => {};
}

export const emit = async (event: string, payload?: any) => {
  if (window.electron) {
    // Electron renderer to main doesn't usually have a direct 'emit' to all windows
    // We simulate it or call a main process handler
    // Electron 渲染进程到主进程通常没有直接广播到所有窗口的 'emit'，
    // 但我们可以模拟它或调用主进程处理程序。
    return window.electron.invoke('emit_event', { event, payload });
  }
}
