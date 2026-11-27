using System;using System.Runtime.InteropServices;using System.Diagnostics;
public class ThemeWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int L,T,R,B;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc cb,IntPtr p);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr GetStyle(IntPtr h,int n);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)]public static extern IntPtr SetStyle(IntPtr h,int n,IntPtr v);
 [DllImport("user32.dll",SetLastError=true)]public static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
 [DllImport("user32.dll")]public static extern bool GetLayeredWindowAttributes(IntPtr h,out uint key,out byte alpha,out uint flags);
 [DllImport("user32.dll")]public static extern bool RedrawWindow(IntPtr h,IntPtr rect,IntPtr region,uint flags);
 [DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
 [DllImport("dwmapi.dll")]public static extern int DwmSetWindowAttribute(IntPtr h,int attribute,ref int value,int size);
 [DllImport("dwmapi.dll")]public static extern int DwmFlush();
 public static int Backdrop(IntPtr h){int value;return DwmGetWindowAttribute(h,38,out value,4)==0?value:-1;}
 public static bool SetBackdrop(IntPtr h,int value){return DwmSetWindowAttribute(h,38,ref value,4)==0;}
 public static long Find(uint pid,long preferred){uint owner;IntPtr known=new IntPtr(preferred);GetWindowThreadProcessId(known,out owner);if(preferred!=0&&IsWindow(known)&&owner==pid&&(GetStyle(known,-20).ToInt64()&0x80)==0)return preferred;long best=0,area=0;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);Rect r;if(id==pid&&IsWindowVisible(h)&&(GetStyle(h,-20).ToInt64()&0x80)==0&&GetWindowRect(h,out r)){long a=(long)(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h.ToInt64();}}return true;},IntPtr.Zero);return best;}
 public static string Layer(IntPtr h){uint k,f;byte a;bool ok=GetLayeredWindowAttributes(h,out k,out a,out f);return ok?String.Format("{0},{1},{2}",k,a,f):"";}
}
