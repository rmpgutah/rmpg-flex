// Improvement 66: API endpoint catalog
import { Express } from 'express';

interface EndpointInfo {
  method: string;
  path: string;
  middleware: string[];
}

/** Extract all registered routes from an Express app */
export function getEndpointCatalog(app: Express): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  
  function extractRoutes(stack: any[], basePath: string = ''): void {
    if (!stack) return;
    
    for (const layer of stack) {
      if (layer.route) {
        // Direct route
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        const path = basePath + (layer.route.path || '');
        const middleware = (layer.route.stack || [])
          .map((s: any) => s.name || 'anonymous')
          .filter((n: string) => n !== '<anonymous>' && n !== 'anonymous');
        
        for (const method of methods) {
          endpoints.push({ method, path: path || '/', middleware });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Nested router
        const prefix = layer.regexp?.source
          ?.replace(/\\\//g, '/')
          ?.replace(/\^/g, '')
          ?.replace(/\$/, '')
          ?.replace(/\?(?:=.*)?/g, '')
          ?.replace(/\(\?:([^)]+)\)/g, '$1')
          || '';
        
        extractRoutes(layer.handle.stack, basePath + prefix);
      }
    }
  }
  
  try {
    const stack = (app as any)._router?.stack;
    if (stack) {
      extractRoutes(stack);
    }
  } catch {
    // Express internals may change
  }
  
  return endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Get endpoint count summary */
export function getEndpointSummary(app: Express): { total: number; byMethod: Record<string, number> } {
  const catalog = getEndpointCatalog(app);
  const byMethod: Record<string, number> = {};
  
  for (const ep of catalog) {
    byMethod[ep.method] = (byMethod[ep.method] || 0) + 1;
  }
  
  return { total: catalog.length, byMethod };
}
