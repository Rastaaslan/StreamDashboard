// F04 Windows ClipForge laboratory process supervisor — not a production binary.
// Compile on FIXE with Framework64 v4.0.30319 csc /platform:x64; no user installer.
// CreateProcessW(CREATE_SUSPENDED) -> AssignProcessToJobObject -> ResumeThread.
// KILL_ON_JOB_CLOSE, active-process=1, process-memory and CPU-time limits;
// no shell, no stdout secrets and no inherited general environment beyond the
// intentionally minimal environment provided by the Node laboratory caller.
using System;
using System.Text;
using System.Runtime.InteropServices;

internal static class ClipJob {
  const uint CREATE_SUSPENDED=0x00000004, CREATE_NO_WINDOW=0x08000000;
  const uint STARTF_USESTDHANDLES=0x00000100;
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS=0x00000008;
  const uint JOB_OBJECT_LIMIT_PROCESS_TIME=0x00000002;
  const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY=0x00000100;
  const uint JOB_OBJECT_LIMIT_PRIORITY_CLASS=0x00000020;
  const uint IDLE_PRIORITY_CLASS=0x00000040;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x00002000;
  const uint DUPLICATE_SAME_ACCESS=0x00000002;
  const uint WAIT_OBJECT_0=0, WAIT_TIMEOUT=0x00000102;
  const uint INFINITE=0xFFFFFFFF;
  const int JobObjectExtendedLimitInformation=9;
  const uint LIMITS=JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_TIME |
     JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_PRIORITY_CLASS |
     JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit {
    public BasicLimit BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  struct StartupInfo {
    public uint cb;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpReserved;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDesktop;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpTitle;
    public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;
    public ushort wShowWindow,cbReserved2;
    public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo {
    public IntPtr hProcess,hThread;
    public uint dwProcessId,dwThreadId;
  }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
  static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job,int infoClass,IntPtr info,uint length);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
  static extern bool CreateProcess(string exe,StringBuilder command,
    IntPtr processAttributes,IntPtr threadAttributes,bool inherit,
    uint flags,IntPtr environment,string workingDirectory,ref StartupInfo si,
    out ProcessInfo pi);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr sourceHandle,
    IntPtr targetProcess,out IntPtr targetHandle,uint desiredAccess,
    bool inherit,uint options);

  static bool Good(IntPtr h) {return h!=IntPtr.Zero&&h!=new IntPtr(-1);}
  static IntPtr DuplicateStd(int n) {
    IntPtr result;
    if(!DuplicateHandle(GetCurrentProcess(),GetStdHandle(n),GetCurrentProcess(),
       out result,0,true,DUPLICATE_SAME_ACCESS))throw new InvalidOperationException("STD_HANDLE");
    return result;
  }
  // Windows command line quoting: pair each backslash before a literal quote;
  // double trailing backslashes before the closing quote.
  static string Quote(string argument) {
    if(argument.Length==0)return "\"\"";
    if(argument.IndexOfAny(new char[]{' ','\t','\n','\v','"'})<0)return argument;
    var sb=new StringBuilder("\"");
    int slashes=0;
    foreach(char c in argument){
      if(c=='\\'){slashes++;continue;}
      if(c=='"'){sb.Append('\\',slashes*2+1);sb.Append('"');}
      else {sb.Append('\\',slashes);sb.Append(c);}
      slashes=0;
    }
    sb.Append('\\',slashes*2);sb.Append('"');
    return sb.ToString();
  }
  static int Execute(string[] args) {
    // args: absolute native exe, wallMs 1..180000, memory bytes 64MiB..1GiB,
    // CPU seconds 1..120, then strictly caller-generated FFmpeg/ffprobe args.
    if(args.Length<5||!System.IO.Path.IsPathRooted(args[0])||!System.IO.File.Exists(args[0]))
      return 70;
    uint wall;long memory,cpu;
    if(!uint.TryParse(args[1],out wall)||wall<1||wall>180000||
       !long.TryParse(args[2],out memory)||memory<64L*1024*1024||memory>1024L*1024*1024||
       !long.TryParse(args[3],out cpu)||cpu<1||cpu>120)return 70;
    if(!System.IO.Path.IsPathRooted(args[4]) || !System.IO.Directory.Exists(args[4]))return 70;

    IntPtr job=IntPtr.Zero,info=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero;
    ProcessInfo child=new ProcessInfo();
    try{
      job=CreateJobObject(IntPtr.Zero,null);
      if(!Good(job))return 71;
      var limits=new ExtendedLimit();
      limits.BasicLimitInformation.LimitFlags=LIMITS;
      limits.BasicLimitInformation.ActiveProcessLimit=1;
      limits.BasicLimitInformation.PriorityClass=IDLE_PRIORITY_CLASS;
      limits.BasicLimitInformation.PerProcessUserTimeLimit=cpu*10000000L;
      limits.ProcessMemoryLimit=new UIntPtr((ulong)memory);
      info=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ExtendedLimit)));
      Marshal.StructureToPtr(limits,info,false);
      if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,info,
          (uint)Marshal.SizeOf(typeof(ExtendedLimit))))return 71;
      input=DuplicateStd(-10);output=DuplicateStd(-11);error=DuplicateStd(-12);
      var startup=new StartupInfo();
      startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfo));
      startup.dwFlags=STARTF_USESTDHANDLES;
      startup.hStdInput=input;startup.hStdOutput=output;startup.hStdError=error;
      var command=new StringBuilder(Quote(args[0]));
      for(int i=5;i<args.Length;i++){command.Append(' ');command.Append(Quote(args[i]));}
      if(!CreateProcess(args[0],command,IntPtr.Zero,IntPtr.Zero,true,
          CREATE_SUSPENDED|CREATE_NO_WINDOW,IntPtr.Zero,args[4],ref startup,out child))return 72;
      if(!AssignProcessToJobObject(job,child.hProcess)){
        // On failure, terminate the still-suspended process, never resume it.
        TerminateProcess(child.hProcess,73);
        WaitForSingleObject(child.hProcess,5000);
        return 73;
      }
      if(ResumeThread(child.hThread)==INFINITE)return 74;
      uint wait=WaitForSingleObject(child.hProcess,wall);
      if(wait!=WAIT_OBJECT_0) {TerminateJobObject(job,124);return wait==WAIT_TIMEOUT?124:75;}
      uint code;
      if(!GetExitCodeProcess(child.hProcess,out code))return 76;
      return code==0?0:code<64?(int)code:77;
    }finally {
      // On every failure and on helper exit, KILL_ON_JOB_CLOSE ensures no
      // transcoder descendants can outlive this process.
      if(Good(child.hThread))CloseHandle(child.hThread);
      if(Good(child.hProcess))CloseHandle(child.hProcess);
      if(Good(input))CloseHandle(input);
      if(Good(output))CloseHandle(output);
      if(Good(error))CloseHandle(error);
      if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info);
      if(Good(job))CloseHandle(job);
    }
  }
  static int Main(string[] args) {
    try {return Execute(args);}
    catch {return 79;} // Never print file paths, args, environment or credentials.
  }
}
