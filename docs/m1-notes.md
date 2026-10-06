# Milestone 1 notes: rules questions found while building the engine

Per plan 11.2, rule questions go back into the rules document instead of being patched in code. Each item below is an
interpretation the engine makes today. Decide, then update Rules v4 and the matching code/test.

1. **Backing "10-15 points across the table" (plan 4.4, Appendix A).** The exact gain from Trained backing on a Capable Skill
   is 15.6 / 12.2 / 9.1 points against Simple / Ordinary / Demanding, then 7.3, 6.1, 4.6, 3.6 up to Mythic. The claim only
   holds near the Skill's own row. The test asserts the true figures. All 96 Appendix A entries otherwise match the engine
   (the appendix rounds half-to-even).
2. **Bad chapter position (Rules v4 7.3).** "Second or third, not the most recent" contradicts itself with three chapters
   (the third is the most recent). The engine accepts the second chapter only for three, and the second or third for four.
3. **Odds-word boundaries (3.11).** 60-80% is Favored but "over 80" is Sure bet, and "under 20" is Desperate, so 20 exactly is
   Long shot, 40 is Even, 60 is Favored, 80 is still Favored. Comparisons are integer-exact.
4. **Edge rule uses the net Danger shift (3.9).** Armor (-1) plus a strained wound (+1) on a Minor Danger cancel; nothing leaks
   to the Skill. Applying them one at a time would depend on listing order.
5. **Edge rule in battle (4.2).** It is applied to the lead's own Danger (where it can move the lead's Skill). A Cover on a
   contributor's Danger already at Minor is lost.
6. **One kept die serves both ladders.** The better of Skill and backing is compared to the Difficulty die and the Danger die(s).
7. **Flourish** needs a successful goal and the kept value to be the top face of the die that produced it (either die on a tie).
   **Belief success** is any success with backing, whichever die was kept.
8. **Standard push re-throws everything** (Skill, backing, Difficulty). An avoided Danger is rechecked with the new kept die
   one rank worse; severity and worst wound stay as set.
9. **Critical wounds** impose no automatic Skill shift ("may drop to Untrained or Hampered") because that is the GM's call;
   `woundShifts` covers Hurt and Wounded only.
10. **Healing into a full row** is rejected (heal the lower row first). Rules 6.4 does not say.
11. **Laying down a Burden at the Conviction cap** is allowed but gains no token.
