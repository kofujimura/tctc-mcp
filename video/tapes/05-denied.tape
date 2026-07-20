# Scene 5 (draft): the agent checks again — permission is gone.
Output video/out/05-denied.mp4
Set Shell "bash"
Set Width 1280
Set Height 720
Set Padding 32
Set FontSize 21
Set Theme "Dracula"
Set TypingSpeed 50ms
Set WaitTimeout 120s

Hide
Type "export AGENT=0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03"
Enter
Type "clear"
Enter
Show
Sleep 800ms
Type "# The agent checks its own permission before acting…"
Enter
Sleep 500ms
Type "node scripts/tctc-call.mjs check_role MINTER_ROLE $AGENT"
Enter
Wait+Screen /not held/
Sleep 1.5s
Type "# balance 0 — the capability is gone. Enforced on-chain, not by a server."
Enter
Sleep 3.5s
