import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * A console program that prints the image names of a process's children, other than itself, from a
 * Toolhelp snapshot of the process table. Not WMI (Get-CimInstance Win32_Process): its first query
 * on a fresh CI machine can take over a minute.
 */
const SOURCE = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ChildProcesses {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct ProcessEntry {
    public uint Size, Usage, ProcessId; public IntPtr DefaultHeapId; public uint ModuleId, Threads, ParentProcessId;
    public int PriorityClassBase; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll")] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  public static void Main(string[] args) {
    uint parent = uint.Parse(args[0]), self = GetCurrentProcessId();
    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) throw new Win32Exception();
    try {
      var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
      if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception();
      do {
        if (entry.ParentProcessId == parent && entry.ProcessId != self) Console.WriteLine(entry.ExeFile);
      } while (Process32NextW(snapshot, ref entry));
    } finally {
      CloseHandle(snapshot);
    }
  }
}
`

/** How long compiling may take: the C# compiler's first run on a fresh CI machine is slow. */
export const COMPILE_TIMEOUT = 120_000

export interface ChildProcessLister {
  /**
   * The image names of the processes `pid` started, as Windows lists them. Asked without blocking,
   * so a slow answer counts against the test's timeouts instead of stalling them.
   */
  names(pid: number): Promise<string[]>
  dispose(): Promise<void>
}

/**
 * Compiles the lister once, through Add-Type in Windows PowerShell 5.1, so that each listing after
 * it only starts a small program. Allow it COMPILE_TIMEOUT, in a hook rather than in a test.
 */
export async function createChildProcessLister(): Promise<ChildProcessLister> {
  const dir = await mkdtemp(join(tmpdir(), 'claudeforge-child-processes-'))
  const source = join(dir, 'ChildProcesses.cs')
  const program = join(dir, 'ChildProcesses.exe')
  await writeFile(source, SOURCE)
  const quote = (path: string): string => `'${path.replace(/'/g, "''")}'`
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -Path ${quote(source)} -OutputType ConsoleApplication -OutputAssembly ${quote(program)}`
    ],
    { windowsHide: true, timeout: COMPILE_TIMEOUT }
  )
  return {
    async names(pid) {
      const { stdout } = await run(program, [String(pid)], { windowsHide: true, timeout: 10_000 })
      return stdout.split(/\r?\n/).filter(Boolean)
    },
    dispose: () => rm(dir, { recursive: true, force: true })
  }
}
