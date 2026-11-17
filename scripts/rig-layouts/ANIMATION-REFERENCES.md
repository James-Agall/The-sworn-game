# Character animation references — 2026-11-17

Research guide for the shared foot/mounted rig. Sources were located and text reviewed; video motion has not been frame-traced or imported. These are references for subsequent animation tuning, not claims that the rig reproduces historical techniques exactly.

| Animation | Reference | Application to our rig |
| --- | --- | --- |
| Walking, idle and general body motion | [CMU motion capture library](https://mocap.cs.cmu.edu/subjects.php), [walking subject 76](https://mocap.cs.cmu.edu/search.php?subjectnumber=76) | Compare foot contact, passing poses, opposite arm movement and body weight shifts. Select and inspect individual clips before copying timing. |
| Sword and shield | [Royal Armouries sword combat film](https://www.youtube.com/watch?v=MOwAgWzdB2Q), [I.33 manuscript context](https://www.csmc.uni-hamburg.de/about/blog/2022-04-22-sword-fighting.html) | Guard, extension, recovery and shield coverage. Our user-requested right-hand shield reverses the usual weapon/shield handedness in many references. |
| Axe, spear and mounted combat | [Mair manuscript images and transcriptions](https://www.wiktenauer.com/wiki/Paulus_hector_mair) | Pose and balance reference. Poleaxe passages describe TWO-handed weapons: do not copy those grips directly onto our one-handed axe/shield combination. Adapt cautiously; manuscript stills do not establish animation timing. |
| Mounted idle, walk and attacks | [British Horse Society rider guidance](https://www.bhs.org.uk/media/egufhctq/silver-about-the-rider-checklist-guidance-v2-08062020.pdf) | Stable balanced seat, torso moving with horse, no reliance on reins for balance. Keep hips attached to saddle while shoulders and arms move. This is riding guidance, not mounted combat instruction. |
| Bow draw, release and recovery | [World Archery barebow technique](https://www.worldarchery.sport/sport/equipment/barebow) | Raise, draw to face, anchor, release and follow-through. Use body mechanics only; retain medieval game equipment. |
| Hurt recoil | CMU general motion library above, then staged acting reference | Needs a specifically inspected balance-loss/recovery clip before claiming a reference-matched recoil. Keep the crimson hit effect separate from body movement. |

Shield update: source silhouettes are round already. Removed renderer's 0.62 horizontal compression; normalize visible width to height and scale both diameters 1.15. Right-arm attachment remains unchanged. The width increase from the previous oval includes undoing its compression; the round shield's diameter is enlarged only 15%.
