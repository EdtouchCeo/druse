import win32com.client as w, sys, os
src=os.path.abspath(sys.argv[1]); dst=os.path.abspath(sys.argv[2])
hwp=w.Dispatch("HWPFrame.HwpObject")
try: hwp.XHwpWindows.Item(0).Visible=False
except Exception as e: print('vis',e)
try: print('reg',hwp.RegisterModule("FilePathCheckDLL","FilePathCheckerModule"))
except Exception as e: print('reg err',e)
hwp.SetMessageBoxMode(0x00020021)
print('open',hwp.Open(src,"HWP","forceopen:true"))
print('save',hwp.SaveAs(dst,"HWPX",""))
hwp.Quit()
