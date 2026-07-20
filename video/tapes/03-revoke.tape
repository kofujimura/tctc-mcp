# Scene 3: the kill switch — burn the agent's control token.
Output video/out/03-revoke.mp4
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
Type "# Kill switch: burn the agent's role token. No server. One transaction."
Enter
Sleep 500ms
Type "node scripts/tctc-call.mjs revoke_role MINTER_ROLE $AGENT"
Enter
Wait+Screen /revoked MINTER_ROLE/
Sleep 4s
