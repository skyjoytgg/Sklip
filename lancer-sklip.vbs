' Lance Sklip (version de développement) sans fenêtre noire : prépare l'interface puis ouvre l'appli.
' Utilisé par le raccourci « Sklip » du bureau.
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName) & "\app"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dossier
sh.Run "cmd /c npm start", 0, False
