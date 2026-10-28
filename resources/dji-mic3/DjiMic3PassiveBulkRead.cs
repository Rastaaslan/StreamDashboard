using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
public static class DjiMic3PassiveBulkRead {
 const uint GENERIC_READ=0x80000000, GENERIC_WRITE=0x40000000, SHARED=3, OPEN_EXISTING=3, FILE_FLAG_OVERLAPPED=0x40000000;
 [StructLayout(LayoutKind.Sequential,Pack=1)] struct USB_INTERFACE_DESCRIPTOR {
  public byte length,descriptorType,number,alternate,numEndpoints,classCode,subclass,protocol,iInterface;
 }
 [StructLayout(LayoutKind.Sequential)] struct WINUSB_PIPE_INFORMATION {
  public int pipeType;public byte pipeId;public ushort maximumPacketSize;public byte interval;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr sa,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_Initialize(IntPtr h,out IntPtr iface);
 [DllImport("winusb.dll")] static extern bool WinUsb_Free(IntPtr h);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_QueryInterfaceSettings(IntPtr h,byte alt,ref USB_INTERFACE_DESCRIPTOR d);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_QueryPipe(IntPtr h,byte alt,byte index,out WINUSB_PIPE_INFORMATION pipe);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_SetCurrentAlternateSetting(IntPtr h,byte alt);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_SetPipePolicy(IntPtr h,byte pipeId,uint policyId,uint size,ref uint value);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_ReadPipe(IntPtr h,byte pipeId,[Out]byte[] buffer,uint max,out uint transferred,IntPtr overlapped);
 [DllImport("winusb.dll",SetLastError=true)] static extern bool WinUsb_AbortPipe(IntPtr h,byte pipeId);
 public static string Probe(string path) {
   if(String.IsNullOrWhiteSpace(path)||!path.StartsWith(@"\\?\USB#VID_2CA3&PID_4015&MI_04#",StringComparison.OrdinalIgnoreCase))return "BAD_PATH";

   // Windows named mutex serializes RX access across the dashboard and the
   // standalone diagnostic: both use the same interface and alternate setting.
   using(var mutex=new Mutex(false, @"Local\StreamDashboard-DJI-Mic3-MI04")) {
     bool acquired=false;
     try {
       try { acquired=mutex.WaitOne(4500); }
       catch(AbandonedMutexException) { acquired=true; }
       if(!acquired) return "RX_READER_BUSY";
   var lines=new List<string>();lines.Add("DJI_MIC3_MI04_PASSIVE_BULK_RX");
   var f=CreateFile(path,GENERIC_READ|GENERIC_WRITE,SHARED,IntPtr.Zero,OPEN_EXISTING,FILE_FLAG_OVERLAPPED,IntPtr.Zero);
   if(f==new IntPtr(-1))return "OPEN_ERROR="+Marshal.GetLastWin32Error();
   try{
     IntPtr usb;
     if(!WinUsb_Initialize(f,out usb))return "WINUSB_ERROR="+Marshal.GetLastWin32Error();
     byte activeAlt=0;
     try {
       var alt1=new USB_INTERFACE_DESCRIPTOR();
       if(!WinUsb_QueryInterfaceSettings(usb,1,ref alt1))return "ALT1_ERROR="+Marshal.GetLastWin32Error();
       if(alt1.number!=4||alt1.alternate!=1||alt1.numEndpoints!=2)return "UNKNOWN_ALT1_CONFIGURATION";
       WINUSB_PIPE_INFORMATION input,output;
       if(!WinUsb_QueryPipe(usb,1,0,out input)||!WinUsb_QueryPipe(usb,1,1,out output))return "PIPES_ERROR="+Marshal.GetLastWin32Error();
       if(input.pipeId!=0x81||output.pipeId!=0x01||input.pipeType!=2||output.pipeType!=2)return "UNKNOWN_ENDPOINTS";
       lines.Add("VERIFIED_PIPE_IN=81 OUT=01; PASSIVE_READ_ONLY, NO_VENDOR_COMMANDS");
       // SET_INTERFACE is a standard USB configuration operation. Restore alt 0 in the finally block.
       if(!WinUsb_SetCurrentAlternateSetting(usb,1))return "ALT1_ENABLE_ERROR="+Marshal.GetLastWin32Error();
       activeAlt=1;lines.Add("ALTERNATE_INTERFACE_1_ACTIVATED_TEMPORARILY");
       uint policy=3, timeout=1200, policySize=sizeof(uint);
       if(!WinUsb_SetPipePolicy(usb,0x81,policy,policySize,ref timeout))lines.Add("READ_TIMEOUT_SET_ERROR="+Marshal.GetLastWin32Error());
       var buf=new byte[4096];var clock=Stopwatch.StartNew();int reads=0;
       while(reads<7&&clock.ElapsedMilliseconds<6000){
         uint got;var ok=WinUsb_ReadPipe(usb,0x81,buf,(uint)buf.Length,out got,IntPtr.Zero);
         int err=Marshal.GetLastWin32Error();
         lines.Add("READ_"+reads+"="+(ok?"OK":"ERROR")+" BYTES="+got+" ERROR="+(ok?0:err));
         if(ok&&got>0) {
           int length=(int)Math.Min(got,200);
           lines.Add("DATA_"+reads+"_HEX="+BitConverter.ToString(buf,0,length));
           if(got>length)lines.Add("DATA_TRUNCATED_AT="+length);
         }
         reads++;
         if(!ok && (err==6||err==87||err==1||err==31))break;
       }
     } finally {
       if(activeAlt==1){
         // Closing/abort cancels reads. No writes are sent to the OUT endpoint.
         bool restored=WinUsb_SetCurrentAlternateSetting(usb,0);
         lines.Add("RESTORE_ALT0="+restored+" ERROR="+(restored?0:Marshal.GetLastWin32Error()));
       }
       WinUsb_Free(usb);
     }
   } finally{CloseHandle(f);}
   return String.Join("\n",lines);
     } finally {
       if(acquired) mutex.ReleaseMutex();
     }
   }
 }
}

