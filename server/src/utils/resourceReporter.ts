// Improvement 68: System resource usage reporter
import os from 'os';
import { logger } from './logger';

interface ResourceReport {
  cpu: {
    cores: number;
    model: string;
    loadAverage: { '1min': number; '5min': number; '15min': number };
    usage: { user: number; system: number; idle: number } | null;
  };
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usagePercent: number;
    process: {
      heapUsedMb: number;
      heapTotalMb: number;
      rssMb: number;
      externalMb: number;
    };
  };
  disk: null; // Would need child_process for disk stats
  network: {
    interfaces: Array<{ name: string; address: string; family: string }>;
  };
  uptime: {
    system: number;
    process: number;
  };
}

let previousCpuTimes: { user: number; nice: number; sys: number; idle: number; irq: number } | null = null;

/** Collect system resource usage report */
export function getResourceReport(): ResourceReport {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  
  // CPU usage calculation
  let cpuUsage: { user: number; system: number; idle: number } | null = null;
  if (cpus.length > 0) {
    const currentTimes = cpus.reduce(
      (acc, cpu) => ({
        user: acc.user + cpu.times.user,
        nice: acc.nice + cpu.times.nice,
        sys: acc.sys + cpu.times.sys,
        idle: acc.idle + cpu.times.idle,
        irq: acc.irq + cpu.times.irq,
      }),
      { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    );
    
    if (previousCpuTimes) {
      const diffUser = currentTimes.user - previousCpuTimes.user;
      const diffSys = currentTimes.sys - previousCpuTimes.sys;
      const diffIdle = currentTimes.idle - previousCpuTimes.idle;
      const total = diffUser + diffSys + diffIdle;
      
      if (total > 0) {
        cpuUsage = {
          user: Math.round((diffUser / total) * 10000) / 100,
          system: Math.round((diffSys / total) * 10000) / 100,
          idle: Math.round((diffIdle / total) * 10000) / 100,
        };
      }
    }
    
    previousCpuTimes = currentTimes;
  }
  
  // Network interfaces (non-internal only)
  const netInterfaces = os.networkInterfaces();
  const interfaces: Array<{ name: string; address: string; family: string }> = [];
  for (const [name, addrs] of Object.entries(netInterfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal) {
        interfaces.push({ name, address: addr.address, family: addr.family });
      }
    }
  }
  
  return {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
      loadAverage: { '1min': loadAvg[0], '5min': loadAvg[1], '15min': loadAvg[2] },
      usage: cpuUsage,
    },
    memory: {
      totalMb: Math.round(totalMem / 1024 / 1024),
      freeMb: Math.round(freeMem / 1024 / 1024),
      usedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 10000) / 100,
      process: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        rssMb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        externalMb: Math.round(mem.external / 1024 / 1024 * 100) / 100,
      },
    },
    disk: null,
    network: { interfaces },
    uptime: {
      system: Math.round(os.uptime()),
      process: Math.round(process.uptime()),
    },
  };
}

/** Log resource usage periodically (call from scheduler) */
export function logResourceUsage(): void {
  const report = getResourceReport();
  logger.info({
    cpuLoad: report.cpu.loadAverage['1min'],
    memUsagePercent: report.memory.usagePercent,
    heapUsedMb: report.memory.process.heapUsedMb,
    rssMb: report.memory.process.rssMb,
  }, 'Resource usage snapshot');
}
