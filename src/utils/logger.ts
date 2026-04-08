/**
 * 日志工具
 * 
 * 参考钉钉插件的日志实现
 */

/**
 * 创建日志记录器
 */
export function createLogger(debug: boolean, prefix?: string) {
  const p = prefix ? `[${prefix}] ` : '';
  
  return {
    info: (...args: any[]) => {
      console.log(`${p}${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    },
    warn: (...args: any[]) => {
      console.warn(`${p}${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    },
    error: (...args: any[]) => {
      console.error(`${p}${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    },
    debug: (...args: any[]) => {
      if (debug) {
        console.log(`${p}[DEBUG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
      }
    },
  };
}

/**
 * 根据配置创建日志记录器
 */
export function createLoggerFromConfig(config: any, prefix?: string) {
  return createLogger(config?.debug ?? false, prefix);
}
