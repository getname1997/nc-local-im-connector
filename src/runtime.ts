import type { PluginRuntime } from "openclaw/plugin-sdk";

/**
 * 本地 IM Runtime 存储
 * 避免直接传递 runtime，在需要的地方通过 getLocalIMRuntime() 获取
 */
function createRuntimeStore<T>(errorMessage: string) {
  let runtimeValue: T | null = null;

  return {
    setRuntime: (next: T): void => {
      runtimeValue = next;
    },
    clearRuntime: (): void => {
      runtimeValue = null;
    },
    tryGetRuntime: (): T | null => {
      return runtimeValue;
    },
    getRuntime: (): T => {
      if (runtimeValue === null) {
        throw new Error(errorMessage);
      }
      return runtimeValue;
    },
  };
}

const { setRuntime: setLocalIMRuntime, getRuntime: getLocalIMRuntime } =
    createRuntimeStore<PluginRuntime>("LocalIM runtime not initialized");

export { getLocalIMRuntime, setLocalIMRuntime };
