# Player combat — 25 November 2026

## Controls and resulting play

- Aim with the cursor. Movement provides the direction until a mouse aim has been supplied.
- Tap Space for a normal strike. Hold for at least 0.4 seconds for a heavy strike or stronger bow draw, then release. A held input releases once at 1.1 seconds. Farming tools retain their hotbar behaviour; choose a weapon or put the tool away to fight.
- Hold right mouse to guard with an equipped shield. It covers the front, reduces ordinary damage by 60% before existing armour, slows movement and prevents attacking. The first 0.2 seconds can perfectly block ordinary attacks; the window cannot be refreshed by rapidly toggling guard. A perfect block grants a brief 25% counterattack bonus and staggers an ordinary attacker. Heavy blows break the guard; poison and environmental damage bypass it.
- Tap Shift for a short, collision-checked sidestep in the movement direction, or sideways from your aim when standing still. It lasts 0.2 seconds and has a 1.5-second cooldown. It gives no invulnerability. Shift+Space still pauses; existing Shift shortcuts and Shift+wheel retain their functions.
- Mounted heroes use passing attacks and normal riding movement for defence. Actual forward movement adds up to 25% melee damage. Moving mounted attacks stay within a forward sector, tighter for spear thrusts. Horses do not sidestep. Equipment changes and mounting/dismounting cancel an incompatible pending attack.

## Weapon identity

| Weapon | Normal / heavy behaviour |
| --- | --- |
| Sword | Forward sweep; up to 3 targets; heavier damage and longer recovery when charged |
| Axe | Slower sweep; 2 normal / 3 heavy targets; heavy strikes break an enemy's frontal guard |
| Spear | Narrow thrust; 64 / 82px reach; 1 normal / 2 heavy targets |
| Bow | Aimed line with draw and recovery; 160 / 224px reach; nearest valid target on the line |

Damage lands once at the contact stage, rather than immediately on input. The client maps preparation, contact and recovery onto existing sprite frames. Small attack trails, shield sparks, charge cues and a parchment control strip provide feedback. Character artwork is not tinted or regenerated.

The same scheduled hit and geometry rules apply in the overworld and hostile camp, cave, ruin and mine interiors. Closed gates and structural cover block attacks; arrows can cross water. Hostile-interior containers also respect attack direction. Peaceful building interiors remain peaceful. Spells retain their existing effects, and cannot be used to cancel attack recovery or an active sidestep.

## Enemies and cost boundaries

Only enemies fighting a player use the new duel states. They commit to an attack direction, warn before impact and recover afterward. Four profiles reuse the existing art: reckless attackers, shield defenders, distance keepers and archers. Existing named-boss attacks remain in place and now pass directional damage information to the shield system. Army-versus-army attack rules remain in use.

This adds small per-actor timers and local hit checks, with no extra path searches for duels, projectile physics, new stamina resource or new art sheets. The existing rest and work-energy systems are unchanged. Bow arrows remain inexpensive visual effects with authoritative line hits, rather than simulated physical projectiles. Sprite directions remain the existing left/right art; trails and ground cues convey the finer aiming direction.

## Verification

- 17 integrated regression scenarios passed, covering contact timing, one hit per swing, facing, buffered attacks, all four weapons, cover and closed gates, directional guard and parry limits, pause release, sidestep limits, equipment swaps, room changes, enemy commitment, camps/caves/ruins, actual horse mounting, forward-motion damage caps and the mounted spear sector.
- Existing hero, hero-tools, mines, spells, smoke, snapshot-delta, save/load, animals, forest-collision, fortifications, interiors, combat-line and adventure suites passed. The adventure wrapper covers layout, bosses and gameplay. Server and client TypeScript checks passed.
- The first combat-line run exposed reduced surrounding spread. Fixed by preserving engagement-slot settling between committed attacks; the final surround suite passed. The test was not weakened.
- Private browser trace captured charge, windup, recovery, guard, dodge and ready states, shield-block feedback and enemy windup/recovery. A normal 500hp target fell to 468.5hp from the charged sword hit. The indoor target fell from 200 to 168.5hp with the same attack. Screenshot: interior-combat.jpg. No browser errors or warnings were captured.
- Small browser scene: 60fps on the current display; observed world CPU approximately 3.6ms average / 5.3ms p95, interior 1.7 / 2.6ms. These are limited scenes, not a 100fps guarantee.

## Crowded server benchmark

Same private seed-42 harness, 300 soldiers versus 300 enemies, 6.5-second unprofiled windows:

| | Previous release 1e2e52b | Player-combat build |
| --- | --- | --- |
| Mean tick | 9.52ms | 10.47ms |
| p95 tick | 16.91ms | 17.70ms |
| Maximum tick | 25.97ms | 25.69ms |
| Surviving mobs | 292 | 293 |

The new sample is about 10% higher on the mean and 5% higher on p95. Random entity size/contact patterns and path searches differ, so this is an indicative gameplay comparison, not an isolated microbenchmark or a claim of a performance improvement. Both remain below the 50ms simulation-tick budget in these windows. Larger battles and latency still need wider playtesting.

## Rollout and known scope

The local update is recorded separately in deployment.json after source comparison, HTTP and WebSocket checks. A frozen copy of the previous live source, built client and shutdown saves is retained before restarting the local game. Combat state is transient and cleared on load, new world, death or room transition; no save format migration is required.

The isolated preview fixture is behind the existing COLONY_TEST_HOOKS gate and is disabled in the live game. Previous unrelated lumberjack-regrowth test failures remain documented in the forest-collision report; that system was not changed in this release. Balance values are initial tuning and can be adjusted centrally in shared/src/combatRules.ts.
