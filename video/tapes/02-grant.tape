# Scene 2 (draft stand-in): the principal grants MINTER_ROLE.
Output video/out/02-grant.mp4
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
Type "# Grant the AI agent a minting permission: mint it a role token (SBT)"
Enter
Sleep 500ms
Type "node scripts/tctc-call.mjs grant_role MINTER_ROLE $AGENT"
Enter
Wait+Screen /granted MINTER_ROLE/
Sleep 2.5s
Type "node scripts/tctc-call.mjs check_role MINTER_ROLE $AGENT"
Enter
Wait+Screen /held/
Sleep 3.5s
