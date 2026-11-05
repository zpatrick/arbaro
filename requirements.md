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
- [ ] A minimal UI drawn from the same language, such as parallel lines of different lengths.
- [ ] Twigs and root hairs curl into spirals when they reach full length.
- Translate the references' principles into original procedural art. Never ship the images.

## The tree

### Growing and steering

- [x] Hold up to grow the selected limb; left and right steer it. R replants.
- [x] A tree starts as a short sprout, framed close. The camera pulls back as it grows, never
      letting it grow out of the view.
- [x] Once a tree is several meters tall, growing and steering feel the same on screen at every
      size: bigger trees grow faster and turn more broadly while the camera pulls back.
- [x] Left alone, a limb drifts back toward upright with a gentle meander.
- [ ] Plant the seed by clicking the ground. Roots grow down while the trunk grows up.
- [x] Growth stops at the ground and at the barn: a tip grows up to just short of either and
      halts there, with a short message, and grows on once it is steered clear.
- [ ] Growth is blocked by rocks, other solid obstacles and other limbs.

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
      Cherry clusters grow only on wood up to 7 cm across.
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

- [x] Every flower is a cluster of cherry blossoms, fitted to the sand drawings.
- [x] A cherry cluster is a mound of blossoms on fine stalks from one spur, with a bud or two:
      five notched petals each, deep pink at the heart and pale at the rim, ringed with stamens.
- [x] Each cluster is true to life: about 17 cm across, of blossoms 4 cm across. A flower of the
      usual size is a mound two clusters across, so the blossoms read at the scale of the scene.
- [x] Raising the size grows each flower into a larger mound of
      clusters of their true size, rather than one larger cluster, and the mounds keep the
      spacing they had, so they run together: a young tree's few sparse clusters become a full,
      clustered crown, like the populated trees in the references. A mound sits around the end
      of its twig, which runs into it like a branch into its blossoms, so most mounds wrap their
      limb and only the furthest stand out from it, on a short twig. A cluster settles into this
      as it grows from one cluster across to two, so flowers can grow from small to large.
- [x] Every flower grows on a stalk that leaves the wood leaning toward the limb's tip, as a side
      shoot does, and bends evenly up into the flower without ever hooking. It tapers from the
      wood to the flower, where it is as fine as the cluster's own spur, so the two run
      together. A larger flower grows a stouter stalk, a mound's twig leaves the wood the
      stouter the more clusters across the mound is, and no stalk is more than half as stout as
      the wood it grows from.
- [x] Seen from afar, every blossom is a flat mark with no outline, where it lies when drawn in
      detail: its five rounded petals, or a plain oval when smaller still. Each takes a light, middle or shadow tone, the light the likelier the
      more open its mound is to the sky, the higher its cluster sits in its mound and the nearer
      the front of its cluster it is, so light lies over the top of the canopy and shade gathers
      inside it. Under a far cluster, its stalk runs on into the marks, so they sit on it.
- [x] Closer in, clusters come into detail a few at a time, their outlines fading in as they
      grow, each mark becoming its blossom. Detail spreads from the middle of the view,
      as much as a frame can afford, and too many marks for a frame are painted fewer and larger.
- [x] Flowers only grow on thin wood, and keep to it as their limb grows, so they ride up with
      the tip. One that rides up into the next flower along its side of the limb, as every
      flower below a fork does when the offshoot there thickens the wood, shrinks away, so they
      never bunch; the tree grows its own back where there is room for them.
- [x] Either the player places them, by shift-clicking thin wood, or the tree grows its own: one
      crowning each limb long enough to flower and more along the thin wood behind it. The tree
      grows back a flower the wind takes after a while.
- [x] How many flowers a limb carries follows how much thin wood it has, not a set number: they
      are spaced along all of it, taking turns on either side, so a long twiggy limb carries
      many, a short one a few. Clusters crowd close, each on a twig of its own, mostly short and
      a few long, at varied angles, so a limb carries a crowd of them, not a single row.
- [x] Blossoms unfold as they grow in, and stay open.
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
- [x] Loads weigh limbs down: beehives hanging from a branch, and the snow on flowers.
- [ ] Flowers weigh limbs down by their own weight too.
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
- [x] Rain and snow, each set from none to a downpour or a blizzard, fall across the scene, carried
      by the wind, and stop at the ground.
- [x] Every chunk of falling snow is a body of its own, carried by the wind, and settles on the
      first thing it meets: a flower, which catches its share and whitens; the barn; or the
      ground. The snow belongs to the world rather than the view: there are as many flakes to
      each square meter of air wherever the view pans or zooms, and air coming into view is
      already snowing. Wood lets it by. Snow landing on a roof too steep to hold it rolls down and
      falls from the edge, and snow blown against a wall slides down it. Lying snow slides until
      it stands no steeper than snow can, so it slides off the barn's roof and drops from the
      eaves in chunks that fall all the way to the ground, and drifts pile against the walls the
      wind drives it into. The snow on the flowers weighs their
      limbs down, so a heavy fall bends them. Lying snow melts at a rate the player sets, faster
      in rain.
- [x] Clouds drift across the sky with the wind: banks of layers like brushstrokes, after the
      banded clouds of old prints rather than puffs, each with a round head and a long tail
      tapering to a point, stacked with their heads together, streaming with the wind so their
      tails trail behind them. Each layer is filled flat, hatched faintly along its underside and
      carved finely along its top. How much of the sky they cover and how high they hang are set
      on the weather page.
- [x] Clouds dim the light. Their cover greys the sky and dulls sunrise and sunset, and a bank
      passing over the sun or moon takes away the direct light, so the mountains' shading fades
      and comes back. On a broken day the banks cast soft shadows across the mountains. A thick
      cover hides the sun, the moon and the stars.
- [x] Low cloud lies over the scene as fog, thickest over the distant mountains and the barn.
- [ ] Sunlight travels across the scene as rays. Flowers absorb them; the ground and solid
      obstacles block them.
- [ ] Rain showers come and go.
- [ ] Limits on growth: level edges, solid obstacles, and a sky ceiling that caps height.

## Wildlife

- [x] A tree in flower draws a swarm of bees for every 40 open flowers. The bees build a hive over
      half a day, hanging under low, sturdy, level wood among the flowers, in open air clear of
      other wood and the barn, and never within 8 m of another hive. Low wood leaves the hive in
      reach of a bear.
- [x] A hive is an ink silhouette like the barn: a bell carved with bands of comb and a door. It
      swings from its wood with the wood's motion and the wind, and weighs on its limb with the
      cube of its size. Its comb holds against its weight, the wind, the snow on its shoulders
      and the shaking of the wood, up to a limit that grows more slowly than its weight, so a
      large hive hangs by less. A hurricane or a hard shake tears it loose and it falls; it also
      falls with any limb cut or snapped under it, and its bees scatter.
- [x] By day, bees fly out from a finished hive to the flowers nearby, dance about them a while
      and fly home; by night they stay in. Bees fly about a hive while they build it.
- [ ] Hives grow over a couple of days, up to four times the size they are first built.
- [x] Birds fly across the scene as ink silhouettes like the tree, beating their wings and now
      and then gliding, as often as the player sets. Some, as many as the player sets, land on
      wood in view thick enough to take them and level enough to stand on, clear of the other
      birds there. A bird sitting on a limb weighs on it, so a thin limb sags under it; it sits a
      while and flies off, and flies off at once if its limb is cut or breaks.
- [x] A hive draws a bear after a while. The bear is an ink silhouette ringed with a thin line of
      the sky's color so it stands out against the trunk: one drawn outline of a black bear in
      profile, its back level to a modest rise at the shoulders, its muzzle long, bent with its
      hips, shoulders and head, on four heavy legs. It walks in along the ground with its feet
      stepping in a walk, a stroll or a run.
      It goes after the nearest hive: if it can reach the hive reared up on its hind legs, it
      swipes it down; else it rears up under the wood the hive hangs from and swipes at that,
      shaking it; else it sets its forepaws on the trunk and shoves it in time, rocking the whole
      tree. It eats a hive it brings down and strolls off, and gives up after a while if it
      cannot bring it down.
- [x] Wood falling on a bear strikes it by its weight and speed, and glances off. A light blow
      angers it: it rears and roars, and goes back at the hive longer and harder. A heavier one
      drives it off at a run. One heavy and fast enough kills it: it collapses where it stands,
      lies a while, and fades.

## Game structure

- [ ] A main menu (New game, Options) and a level select. Each level has a name, a short
      description and its goals.
- [ ] Levels set goals for height and flower count. The first, The Meadow, asked for a tree 18 tall
      with 18 flowers.
- [ ] Win by reaching a level's goals; the result shows the height, flowers and day reached.
- [ ] Lose if the tree falls, with a hint at what would have kept it standing.
- [x] Time controls: pause, normal, double and quadruple speed. (In the debug panel for now.)
- [x] Drag to pan and scroll to zoom: around the foot of the tree, so zooming all the way in lands
      on its trunk, or around the pointer once the player has dragged the view. The camera then
      stays where the player left it until F, or planting a new tree, sends it back to following
      the tree.
- [x] The time and the season, in small text in the scene's top left corner, such as "4:00 PM ·
      Late fall". The clock moves on a quarter hour at a time, and each season is early, at its
      height, or late.
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

- [x] A collapsible debug panel down the right, beside the scene rather than over it, with a tab
      down its left edge for each page: weather, the tree, flowers, and wildlife. The scene narrows as the
      panel opens. Time controls stay at the top of every page, and a button at the bottom puts
      every setting back to its default.
- [x] A plain black strip down the left of the scene, kept for tools.
- [x] Time controls: pause the simulation, or run it at normal, double or quadruple speed.
- [x] Weather page: the time of day, set by hand or played on its own at the simulation's speed;
      the season; the wind: a compass whose arrow you drag to point where it blows toward, a
      strength slider, and a choice of wind model with a description of each; how hard it rains
      and snows, and how fast lying snow melts; and how much of the sky the clouds cover and how
      high they hang.
- [x] Tree page: switch between steer-and-grow and flow mode and set the flow rate; multipliers on
      how much the wood and the roots can take; and an overlay showing how close each joint is to
      breaking.
- [x] Flowers page: whether flowers are grown by the tree, as they are to begin with, or placed by
      hand; one size for all of them, from a fifth to five times the usual, which grows clusters
      into mounds; and how hard their stems hold.
- [x] Wildlife page: whether swarms of bees come on their own; one size for every hive, from as
      first built to four times larger; a button that finishes building every hive at once;
      how many birds come by each minute, and how many of them land; whether hives draw bears,
      a button that sends a bear in, a list of a bear's animations to show one playing in
      place, and a button that clears the bears away. A button, or holding H, makes the next
      click on a limb hang a hive from it there.
