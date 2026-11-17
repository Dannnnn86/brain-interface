' start-server.vbs — invisible launcher for the Brain Interface server.
' Invoked by the "BrainInterfaceServer" scheduled task at logon.
' Runs node fully hidden (window style 0) with output appended to a log file.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\projects\44-brain-interface"
sh.Run "cmd /c ""C:\Program Files\nodejs\node.exe"" server\src\index.js --serve-web >> data\server-autostart.log 2>&1", 0, False
