# Arbaro requirements

Arbaro is a side-view game about growing a single tree: "Grow a tree that can stand on its own."
You plant a seed, steer its trunk, branches and roots as they grow, keep it fed with water and
light, and keep it standing against its own weight and the weather.

These requirements come from four places: the original brief, as captured by the first prototype
(the root commit, `78edcf4`); later direction given in chat; the open notes in `backlog.md`; and
the wind and physics requests. A checked box means the current rebuild already does it. Items
marked _open_ are ideas from the backlog that are not decided.

## Priorities

- Visual beauty comes first. "If push comes to shove, I care more about it looking beautiful than
  anything else."
- No visual regressions. Do not trade away how the tree looks for a feature without raising it
  first. Each step records a visual baseline under `baselines/step-N/` to compare against.
- Build in small, iterative steps, each one solid and good-looking before the next.

## Visual language

The standard is the reference set in `references/visual-language/`, mostly JBenart's beach sand
art and tree-of-life drawings.

- [x] Stark, heavy, dark silhouettes on warm sand-colored paper, with a fine sand grain.
- [x] Continuous, smooth tapers and organic curves. No kinks, creases or polygonal joints.
- [x] The trunk flares into the ground with concave root curves that melt into it.
- [x] The ground and the tree are the same dark ink. That reads well and should stay the default
      view.
- [x] Mountains drawn with flowing organic lines, as in the references.
- [x] Lotus flowers as a motif.
- [ ] A minimal UI drawn from the same language, such as parallel lines of different lengths.
- [ ] Twigs and root hairs curl into spirals when they reach full length.
- Translate the references' principles into original procedural art. Never ship the images.

## The tree

### Growing and steering

- [x] Hold up to grow the selected limb; left and right steer it. R replants.
- [x] Growing and steering feel the same on screen at every size: bigger trees grow faster and
      turn more broadly while the camera pulls back.
- [x] Left alone, a limb drifts back toward upright with a gentle meander.
- [ ] Plant the seed by clicking the ground. Roots grow down while the trunk grows up.
- [ ] Growth is blocked by the ground, rocks, solid obstacles and other limbs.

### Offshoots

- [x] "It doesn't really matter what is a trunk and what is a branch. It's the same." Every limb is
      an offshoot that can be grown and steered the same way.
- [x] Click a limb to select it; the selected limb is the one that grows and steers.
- [x] Click the selected limb to fork a new offshoot from that spot, toward the side clicked.
- [x] Branches have stems, and stems can fork too.

### Thickness and junctions

- [x] A limb is as thick as what it carries: below a fork, its cross-section is the sum of the
      limbs above it.
- [x] Wood is true to life beside the barn and the flowers: a twig is under a centimeter across at
      its tip and about two a meter back, and it thickens ever faster toward the trunk, as real
      trees do. A 3.6 m sapling's trunk is about 10 cm across, and an 18 m tree's about 80 cm.
      Flowers grow only on twigs up to 4 cm across.
- [x] Forks blend smoothly into their parents, with a rounded crotch above and a softer collar
      below.
- [x] Wood never shrinks. A limb that loses what it carried keeps its girth, and new growth from a
      cut end narrows smoothly out of it.
- [ ] Spending resources on a limb thickens it, up to a limit. (Original brief.)

### Roots

- [ ] Roots grow, fork and steer like branches, and draw water from the soil.
- [ ] Fine root hairs grow off roots.
- [ ] Roots anchor the tree: the more and wider the roots, the more they resist it tipping over.

### Pruning

- [x] Hold C and click a limb to prune it there. Everything beyond, offshoots included, falls to
      the ground like a broken piece. The stump keeps its girth and can be grown again. The pointer
      turns to a crosshair over a limb while C is held.
- [x] The trunk can be felled down to a short stump. (The original brief kept the first trunk and
      taproot from being pruned.)
- [ ] Part of what was spent on a pruned limb comes back. (Original brief.)

## Resources and growth

The original brief:

- [ ] Two resources: water, drawn up by the roots, and light, gathered from the sun by flowers.
- [ ] Water grows roots and trunk; light grows branches.
- [ ] How much of each can be stored grows with the tree.

Direction from the backlog, which would replace spending on demand. It can be tried as flow mode,
switched on in the debug panel beside the original steer-and-grow controls:

- [x] Growth is a continual process. You never press a button to send resources somewhere; you
      only direct where the flow goes.
- [x] Resources come up the trunk pointing upward. Left alone, the tree just grows taller until it
      reaches a maximum height. Steering a limb steers where its growth goes.
- [x] A branch starts at a spout. Click it to set how much of the flow goes into the branch versus
      on up the trunk (50%, for example). Stems have their own spouts with the same split.
- [x] A spout can give its branch everything, turn it off, or anything between.
- [x] The flow shows as dots of energy that start large, split at each spout by its share, and
      travel out to the tips, where whatever arrives grows the tip in the direction it is steered.
- [x] How fast nutrients rise from the roots can be set in the debug panel.
- _Open._ Water is the currency the flow is made of.
- _Open._ A spout setting that holds its branch steady, taking in just what it loses to decay.
- _Open._ Decay rises with tree mass: more branches, a thicker or taller trunk, and larger branches
  and stems all decay faster. Where more comes in than decays, that part grows. Where less comes
  in, it dies back from the leaf nodes: the top of the trunk and the ends of branches. Where intake
  matches decay, it holds steady. There is no separate homeostasis rate.
- _Open._ Flowers are always leaf nodes. They are given resources like branches and need enough of
  them, and they bring in light energy, a separate currency whose use is not settled.

## Flowers

- [x] Three kinds, drawn from the references: the lotus, the scalloped cloud blossoms of the
      tree-of-life drawings, and the five-petal star flowers on their mound.
- [x] The open lotus follows references 12 and 08: an outer row of long, narrow, pointed petals
      spread nearly flat with their tips turned up, a middle row, and a cup of upright petals,
      each petal carved with a second outline and a midrib, and stamens rising from its heart.
      Closed, it is a smooth pointed bud.
- [x] Flowers are true to life at the usual size: an open lotus is about 27 cm across, a cloud
      blossom 17 cm and a star flower 15 cm.
- [x] Flowers only grow on thin wood, and keep to it as their limb grows, so they ride up with
      the tip.
- [x] Either the player places them, by shift-clicking thin wood, or the tree grows its own: one
      crowning each limb long enough to flower and more along the thin wood behind it. The tree
      grows back a flower the wind takes after a while.
- [x] How many flowers a limb carries follows how much thin wood it has, not a set number: they
      are spaced along all of it, taking turns on either side, at one and a half times their size,
      so a long twiggy limb carries many, a short one a few, and larger flowers fewer.
- [x] Flowers open at sunrise and close into buds at sunset, and are seen opening and closing.
- [x] Through autumn they turn yellow, then orange, then brown, wilt, and drop.
- [x] Strong wind tears flowers loose; a typical open flower starts to go in a storm. A larger
      flower grows a stouter stem, but the wind's pull grows a little faster than its hold, so
      larger flowers are somewhat more exposed. Open flowers catch more wind than closed buds.
      Stems vary at random, grow stronger on limbs that get more of the flow in flow mode, and
      weaken in autumn. As with the wood, brief gusts are survived and sustained overload is not.
- [x] A flower falls when the wood it grows on is cut or breaks off, or the tree falls.
- [ ] Flowers start small and grow larger with light, up to a maximum size.
- [ ] Larger flowers cost more to maintain, so flowers end up at varied, organic sizes: the ones
      getting the most light grow largest, and an older flower is not necessarily a large one.
- [ ] Each flower is in one of three ranges, set by the light it gets against what its size needs:
  - Excess: it grows, up to the maximum size. Growing raises what it needs.
  - Maintenance: it holds its size and recovers toward a healthy color.
  - Deficit: it dies. The further below maintenance, the faster it changes color and dies.
- [ ] Dying runs along a color scale, roughly white to yellow to green to dark brown to black. A
      flower that gets back into maintenance slowly returns to white.
- [x] A dead flower falls off the tree onto the ground and slowly dissolves or fades away.
- [ ] Flowers have weight, and their weight and the wind they catch load the limbs.

## Physics

### What is simulated

- [x] The above-ground tree bends under gravity and wind. Each limb bends at joints as stiff as the
      wood there, so thin twigs flex while thick wood barely moves, and a limb's motion carries
      into everything growing from it.
- [x] The grown shape is the resting shape. Only wind, or weight the tree did not grow with, moves
      it.
- [x] Physics must never cost the look. A bending tree stays one smooth silhouette, with forks and
      root flare intact. A tree at rest looks exactly as it would without physics.
- _Open._ The physics only cares about the tree above ground. Roots do not simulate as bodies of
  their own; they constrain the tree instead. They might add weight at the base of the trunk, so a
  well-rooted tree behaves as if more weight were planted there. Or root mass might gate height:
  passing a height or length (five meters, say) needs a matching amount of root.

### Loads, breaking and falling

- [x] A limb's own weight counts toward what it carries, so a limb grown too long, or a trunk grown
      too tall and crooked, can break under itself.
- [ ] Loads weigh limbs down: flowers, beehives sitting on a branch, and anything else hung on the
      tree.
- [x] Limbs break when the bending stress in them stays past what the wood can take; brief peaks
      are survived, sustained overload is not. The broken piece falls with the motion it had,
      lands, and always fades away a few seconds later, even if the wind keeps rocking it. A
      piece that sat on top of its break tips over on the stump before it falls.
- [x] The tree falls over if the trunk snaps or the roots can no longer hold it upright. Until roots
      exist, a thicker trunk stands for better roots. An uprooted tree tips over on its base, root
      flare and all.
- [x] When weight comes off a limb, the wood that carried it springs back.
- [ ] Warn the player when the roots are struggling or a limb is close to snapping.

### Wind

- [x] Wind has a direction, any way around a full circle including up and down the screen, and a
      strength.
- [x] Several physical models of wind, each with a plain description: steady, gusty, rolling gusts
      that travel across the scene, a resonant pulse, and buffeting eddies.
- [x] Wind slows toward the ground.
- [ ] In play, the weather drives the wind. It varies in strength and direction with gusts, and
      starts gentle so a young tree has time to root.

## World and environment

- [x] A flat world with level ground.
- [ ] Levels with shaped terrain: hills, slopes, rocks underground and solid obstacles above.
- [ ] Soil holds moisture. Rain wets the top layer, and water drains down, spreads sideways and
      evaporates near the surface. Underground water pockets and a water table stay wet.
- [x] A day and night cycle: the sun crosses the sky by day, the moon and stars come out at night,
      and the light on the sky, the wood and the flowers follows, warm at sunrise and sunset. A
      day takes three minutes at normal speed.
- [x] The sun is a plain disc, after the minimal sun of reference 10. (Rays like reference 06 may
      come later.)
- [x] A range of mountains on the horizon behind the tree, after reference 10: ridgelines up to
      sharp peaks, in a far row and a lower near row with a saddle behind the tree. Spurs, forks
      and creases carved down their fronts part each peak into faces, with narrow bands along the
      ridges and spurs. The mountains are filled with the sky, so the sun and moon set behind
      them.
- [x] The mountains' faces are lit by the sun: faces turned from it are hatched, the steepest
      most densely, and faces turned toward a low sun glow warm, so the shading swings across the
      range from morning to evening. The moon shades them more softly by night. They darken into
      silhouettes against sunrise, sunset and the night sky, and their lines turn pale by night.
- [x] A small barn stands on the ground beside the tree, true to size (7 m wide, its ridge at
      5.8 m), so the tree's height can be judged by it. It is ink like the tree, behind it, with
      its doors carved through to the sky's color.
- [ ] Clouds dim the sun.
- [ ] Sunlight travels across the scene as rays. Flowers absorb them; the ground and solid
      obstacles block them.
- [ ] Rain showers come and go.
- [ ] Limits on growth: level edges, solid obstacles, and a sky ceiling that caps height.
- [ ] Clouds and birds drift across the sky as decoration.

## Game structure

- [ ] A main menu (New game, Options) and a level select. Each level has a name, a short
      description and its goals.
- [ ] Levels set goals for height and flower count. The first, The Meadow, asked for a tree 18 tall
      with 18 flowers.
- [ ] Win by reaching a level's goals; the result shows the height, flowers and day reached.
- [ ] Lose if the tree falls, with a hint at what would have kept it standing.
- [x] Time controls: pause, normal, double and quadruple speed. (In the debug panel for now.)
- [x] Drag to pan and scroll to zoom around the pointer. The camera then stays where the player
      left it until F, or planting a new tree, sends it back to following the tree.
- [ ] An in-game display of resources, goal progress, wind and time of day, plus facts about the
      selected limb: length, thickness, what it carries or anchors, its flowers, how close it is to
      snapping, and what it has stored.
- [x] A short message when a limb snaps, the trunk snaps, or the roots give way.
- [ ] A short message when the seed is planted.

## Root view

_Open._ A button flips into a view of the roots:

- Everything above ground recedes (fades, blurs or similar) and the ground shows the roots, which
  read as distinct from it. Turning the view off brings the tree back into focus. The two views
  should feel like they trade places.
- Roots keep their shape and size and can be steered the same way as above ground.
- A toggle shows how much water each root brings in, either by color (bluer for more, browner or
  blacker for less) or by animation: tiny droplets enter through the root hairs, merge into larger
  ones where they meet, and travel up to the base of the trunk.
- An overlay for structural strength is a maybe, since limb size already shows it.
- Underground features show up here: lakes, and rocks the roots should avoid.

## Debug tools

- [x] A collapsible debug panel on the right edge, with a tab down its left edge for each page:
      weather, the tree, and flowers. Time controls stay at the top of every page, and a button
      at the bottom puts every setting back to its default.
- [x] Time controls: pause the simulation, or run it at normal, double or quadruple speed.
- [x] Weather page: the time of day, set by hand or played on its own at the simulation's speed;
      the season; and the wind: a compass whose arrow you drag to point where it blows toward, a
      strength slider, and a choice of wind model with a description of each.
- [x] Tree page: switch between steer-and-grow and flow mode and set the flow rate; multipliers on
      how much the wood and the roots can take; and an overlay showing how close each joint is to
      breaking.
- [x] Flowers page: whether flowers are placed by hand or grown by the tree, their kind or a mix,
      one size for all of them, and how hard their stems hold.
