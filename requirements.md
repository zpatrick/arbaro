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
- [x] The trunk flares into the ground with concave root curves that melt into it. A sapling's
      flare is a small fillet, and so is a trunk already thick for its height; a tall, slender
      trunk fans out, a little wider along the ground and higher up the trunk.
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
- [x] Left alone, a limb drifts back toward upright with a gentle meander. A weeping willow's
      trunk meanders more and rights itself more weakly, so it grows crooked, and its branches
      arch out and over ever further as they lengthen until they weep; they can be steered down
      further than a cherry's, well past level.
- [ ] Plant the seed by clicking the ground. Roots grow down while the trunk grows up.
- [x] Growth stops at the ground, the barn, the farmhouse and the fence: a tip grows up to just
      short of any of them and halts there, with a short message, and grows on once it is steered
      clear.
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
      trees do, until ten meters from its tip; past that it thickens steadily, so a tall trunk
      stays in proportion to its height. A 3.6 m sapling's trunk is about 10 cm across, an 18 m
      tree's about a meter, and a 60 m giant's about four. Cherry clusters grow only on wood up to
      7 cm across.
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
- [x] The spout's popover opens beside it and can be dragged anywhere by its background, where it
      then stays. A click anywhere off it closes it.
- [x] The flow shows as dots of energy that start large, split at each spout by its share, and
      travel out to the tips, where whatever arrives grows the tip in the direction it is steered.
- [x] In flow mode, the arrow keys do nothing; a limb is steered by dragging from its tip. Only
      how far the pointer is out to the limb's left or right, across the way it pointed when
      pressed, counts: the further out, the harder it steers, up to as hard as an arrow key. The
      limb bends to it as it is dragged, just as a held arrow key bends it in steer-and-grow mode.
      While it is dragged, a dashed string runs from its tip to the pointer pulling it.
- [x] Letting go stakes the limb: it grows on as if up and that much left or right were held for
      good, still bending until it leans as far as its species allows, instead of drifting back
      toward its natural shape. Let go with the pointer in line with the limb and it grows on
      straight. It changes only when the tip is dragged again.
- [x] Staking applies only in flow mode. In steer-and-grow mode, the arrow keys steer the selected
      limb and an unsteered tip drifts back toward its natural shape, as before.
- [x] In flow mode, the selected limb is lit by the same soft light traveling along it that lights
      an open spout's branch, as well as the ring at its tip. A tree starts with no limb selected,
      so the first click on a limb selects it and the next forks it, and a click off the tree
      leaves no limb selected again. In steer-and-grow mode a limb stays selected, as it is the one
      the up key grows.
- [x] How fast nutrients rise from the roots can be set in the debug panel.
- _Open._ Water is the currency the flow is made of.
- _Open._ A spout setting that holds its branch steady, taking in just what it loses to decay.
- _Open._ Decay rises with tree mass: more branches, a thicker or taller trunk, and larger branches
  and stems all decay faster. Where more comes in than decays, that part grows. Where less comes
  in, it dies back from the leaf nodes: the top of the trunk and the ends of branches. Where intake
  matches decay, it holds steady. There is no separate homeostasis rate.
- _Open._ Flowers are always leaf nodes. They are given resources like branches and need enough of
  them, and they bring in light energy, a separate currency whose use is not settled.

## Species

- [x] Two species can be planted: a cherry and a weeping willow. Each grows by the same rules of
      wood, steering and physics, with its own habit (see Growing and steering) and its own
      flowers. A planted tree keeps its species; choosing another plants one afresh.
- [x] A willow's flowers are its strands: fine twigs that leave its thin wood, arch over and hang
      straight down, dressed in narrow leaves with golden catkins among them, hung close along
      every thin limb so they make curtains. Strands keep to the rules of a cherry's flowers:
      the player hangs them by shift-clicking thin wood, or the tree hangs its own, one weeping
      from the tip of every limb long enough and more along the thin wood behind it on either
      side; they keep to thin wood as their limb grows, and one riding up into the next withers
      away; the wind tears them loose and the tree grows them back; they fall with wood that is
      cut or breaks, and with the tree; they catch snow, which weighs their limbs down; and their
      catkins draw bees as blossom does.
- [x] At the usual size strands are a young willow's, under a meter long. As the size setting
      grows a cherry's clusters into mounds, it grows a willow's strands into cascades, as a
      mature willow's are: each lengthens in proportion, and from high wood further still, until
      at five times the usual size they drape as much as 85% of the way to the ground, never into
      it or into the sea; its shoot arches out higher and wider, rising more steeply from the
      wood; and more threads hang from along its arch, a few at the usual size and about
      fourteen at five times it. The cascades along a limb run together into a dense crown, domed
      where they arch over. Each strand grows its own share of its length, so the curtain's hem is
      ragged. A strand grows in from a short shoot that sticks out from the wood to its full
      length over a few seconds, arching over as it lengthens.
- [x] Every strand swings as a chain hanging from where it leaves its wood: pulled down by its
      weight, held in its arch where it leaves the wood and limp below, dragged by the air moving
      past it, which gusts and eddies in waves down it, and carried with its wood as the tree
      sways or a bear rocks it. It hangs in a gentle curve of its own, leans about 13 degrees in
      a gentle breeze and 43 in a fresh one, and streams out level in a gale. Leaves catch the
      wind, so a bare strand swings more freely and holds out longer against a storm.
- [x] Leaves are true to life, narrow and pointed, 12 cm long, set every 2.6 cm in a spiral, so
      seen from the side they fall to either side of the twig at random, leaning toward its tip.
      Each strand tapers like a tress: its leaves are smaller further down it, and smallest at a
      growing tip. The other threads of its cascade hang from along its arch, each down to about
      where the strand ends, a little shorter or longer, swinging with it, fanned out a little and
      waving a little on their own, more in a wind.
- [x] Leaves stream toward the way the wind blows and flutter in it, and now and then the wind
      turns one over for a moment to show its pale, sage underside: hardly any in a breeze, more
      the harder it blows, and never so many the tree stops looking green.
- [x] Seen from afar, every leaf is a fine flat mark with no outline, like hatching, in a
      shadow, middle or light tone: lighter high on a strand, on strands open to the sky and on
      those hanging in front of the wood. Half the strands hang behind the wood, in its shade.
      Close in, leaves come into detail with soft outlines and midribs, those nearest the middle
      of the view first. Far off they are painted fewer, each reaching along its thread to the next,
      so a thread is one unbroken streak and a frame stays quick.
- [x] Catkins are silver in the bud, open gold as a strand grows in, and wither brown through
      early autumn before they drop. Close in they are fuzzy with stamens.
- [x] Through autumn a willow's leaves yellow, then turn gold, then old gold and brown, each a
      little earlier or later than the rest, and drop one by one, fluttering down to lie on the
      ground or float on the sea before they fade, until the strands hang bare through winter,
      fine lines of ink. In a gale leaves blow off the strands.
- [x] Snow whitens a willow's leaves and lies along its arches; hanging leaves shed most of it.

## Flowers

- [x] Every flower is a cluster of cherry blossoms, fitted to the sand drawings. (A willow's
      flowers are its strands; see Species.)
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
- [ ] Flowers grow larger over time, with the time of year and with the maturity of the tree. A
      young tree early in the year carries small ones; they enlarge through spring and summer, and
      a mature tree's grow larger still. A willow's strands lengthen the same way.
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

## Fruit and seeds

- [ ] Pollinated flowers become cherries or seed pods. Fruit adds weight to its limbs and attracts
      birds and bears.
- [ ] Seeds that survive become the player's score, or pass traits from the grown tree to the next
      tree.

## Ground cover

Grass and meadow flowers grow on the ground of the farm and the cliff. No one plants or cuts them:
they are part of the world, and they move with the wind, the snow and the weather as the rest of
the scene does. Reference photos are in `references/grass/`.

Three kinds of grass, each after its photo:

- Wildflower meadow grass: grass with flowers standing among it (`wildflower-meadow.png`).
- Meadow grass: fine, bright, blade-thin grass in dense tufts (`meadow-grass.png`).
- Beach/wheat grass: tall, golden grass with seed heads, on the farm after `wheat-grass.jpg`
      and on the beach after `beach-dune-grass.jpg`.

- [x] The farm has all three kinds: wildflower meadow grass, meadow grass and beach/wheat grass.
- [x] The sea level, the beach, has beach/wheat grass on its land, in clumps with bare sand
      between, their blades fanning out.
- [x] The meadow has wildflower meadow grass and meadow grass, in long stretches in turn.
- [x] Grass is drawn in the scene's ink language: fine strokes with tapered tips, in the ground's
      own ink unless the grass colors toggle is on. Meadow grass flops over in waves; beach/wheat
      grass carries slender heads of seed.
- [x] Meadow flowers grow among the grass, the wildflower meadow grass most of all, and bend and
      spring back with the grass under them: spikes of lupine in purple, rose or white, and
      daisies. They are in their colors, as the tree's flowers are, and die back through the fall.
- _Open._ Whether meadow flowers count toward a level's flower goal. They are not the tree's
  flowers.

### Growth and the seasons

- [x] Grass grows taller through spring and summer, and wilts down through autumn and winter, so it
      stands tallest in midsummer and lies lowest in midwinter.

### Color

- [x] A grass colors toggle in the debug panel. Off, the grass is the same color as the ground under
      it. On, the grass is green in summer and changes through autumn and winter, toward straw and
      then bare earth, as the fields do.
- [x] A grass height slider in the debug panel, beside the colors toggle, grows every kind of grass
      and its flowers from a third to three times their usual height.

### Wind, snow and weight

- [x] Grass sways in the wind, and gusts travel across a field as they do across the scene.
- [x] Snow settles on grass as it does on flowers.
- _Open._ Snow should not compact the grass. Laid flat under a fall, it looks wrong. The grass
  might die back under the snow, or stay as it is, with the snow lying over it. Not decided.
- [x] Fallen wood, hives and other pieces that land on grass crush it under their weight: the blades
      beneath bend flat.
- [x] Once the weight is gone, the grass slowly springs back to upright, however long it was
      pressed down.

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
- [ ] Warn the player when the roots are struggling or a limb is close to snapping through the
      tree itself, without relying on meters: fine cracks, trembling joints, bowed limbs,
      disturbed soil, falling petals or strained flow.

### Wind

- [x] Wind has a direction, any way around a full circle including up and down the screen, and a
      strength.
- [x] Several physical models of wind, each with a plain description: steady, gusty, rolling gusts
      that travel across the scene, a resonant pulse, and buffeting eddies.
- [x] Wind slows toward the ground.
- [ ] In play, the weather drives the wind. It varies in strength and direction with gusts, and
      starts gentle so a young tree has time to root.
- [ ] Gale, drought, flood and heavy snow are forecast several days ahead. The player can prepare
      by pruning, reinforcing roots, redirecting growth or sacrificing flowers.
- [ ] Weather arrives visibly instead of changing at once: a cloud bank builds on the horizon, the
      sea picks up and long limbs begin to work before the storm reaches the tree. The player has
      time to see which branches are likely to suffer and prepare them.

## World and environment

- [x] The meadow: a few long, gentle swells of land across it, so the tree stands in a shallow
      dip with a rise to either side. Along the rise to its right runs a long, weathered rail fence
      in ink silhouette, as though it kept to a path, with a gate where the path runs through. No
      barn stands there.
- [x] A fence is drawn after the reference of horses beyond an old fence: rough posts about
      1.1 m tall, most nearly upright and now and then one leaning, their tops cut on a slant just
      above the upper rail. Two rails run between each post and the next, fixed to the posts where
      they stand, running a little past them so the rails of neighboring bays cross, a little
      uneven and sagging between. Now and then a lower rail has come away at one end and rests on
      the ground. The gate is braced corner to corner.
- [x] Every level has edges: to either side, a top in the sky and a floor in the ground. The view
      never zooms out wider or taller than the level, nor pans past its edges, so the ground runs
      no deeper than the level's floor: 6 m down on the meadow, 8 m on the farm and 12 m by the
      sea. The tree grows no closer than 3 m to the level's sides or 5 m to its top; held up
      there, it says the edge of the level is in the way.
- [ ] Levels with shaped terrain: hills, slopes, rocks underground and solid obstacles above.
- [x] A second level, the sea: a hill rolling down gently to the left that rolls off over a
      rounded brink and falls steeply into the sea. An old rail fence runs along the land behind
      the tree. The tree stands on the brink, where the land
      falls away at 45 degrees, leaning out over the water. A ledge of rock at its foot
      bares at low water, and beyond it the seabed shelves away into deep water. High water all
      but reaches the top of the cliff, a meter below the tree, and the horizon lies above it, as
      seen from the hill. Bears come only from the left. No barn stands there, and no mountains
      unless the debug panel puts them back. A fishing village stands on the far shore to the
      right.
- [x] A third level, the farm: long, gentle swells of farmland like the meadow's, level through the
      yard where the farmhouse, the tree and the barn stand, with a rail fence along the rise beyond
      the barn and mountains along the horizon. Wildflower and meadow grass grow toward the left,
      and wheat grass beyond the barn. Bears come from either side.
- [x] The sea along the cliff, drawn as the old prints draw it: shorter and steeper waves than any
      real sea's, so several crests roll in across the view at once. Far off it is a band of fine
      lines crowding toward the horizon, broken by the glitter of the sun or moon below it and,
      in a wind, by little whitecaps. Near, it is a cross-section: its water in the sea's own
      color, taking on a share of the sky's, with contour lines raked through it that swing with
      the water at their depth and still as they go down.
- [x] The waves are swell rolling in from far off and waves of the wind's own, which run the way
      it blows and grow with the open water behind them, so an offshore wind leaves the water
      by the cliff calm. Both build and calm with the sea's momentum rather than at once, while
      ripples follow every gust. Waves stand taller and shorter as the water shoals, and the
      tide, which rises and falls twice a day, moves where they break.
- [x] A wave too tall for its water steepens, its face standing upright and hollowing, then
      breaks: the top of its face rolls over as a round dome whose tip hooks back under it,
      foam spreading back from the tip and claws of foam reaching from it, the tube under it a
      small hollow. The hook plunges onto the water ahead in a crown of foam, the hollow closes,
      and the wave rolls on as a rounded front of foam, leaving foam on the water behind it to
      drift and fade. Every part of this grows from nothing and passes into the next, so a
      breaking wave never jumps. Reaching the cliff, it surges up the rock in a sheet of foam and throws spray up
      the face, higher the bigger the wave and the higher the tide. A strong wind tears the tops
      off steep crests as whitecaps and blows spray off them.
- [x] The sea answers the weather: rain flicks up little crowns of spray from its surface, snow
      melts into it, and its colors follow the light through the day and the night. Wood, hives
      and flowers falling into it splash, float, and bob on the waves, drifting with the water,
      before they fade.
- [x] Across the sea, on the right of the sea level, a fishing village stands on the far shore: a
      dense cluster of red and white houses around a rocky point, cabins and warehouses at the
      water and houses in rows up the slope behind, some side on and some gable end on, turned
      every way, in barn red, white, cream and ochre under slate, grey and red roofs; green hills
      rising gently behind it, wooded in patches, with a few houses alone on them; and a low shore
      far off to the left with a few more. Along the front of the village a harbor wall of dressed
      stone, green with weed below high water, carries a cobbled walk with lamps and benches
      facing the water; elsewhere its shore is bedrock carved in the mountains' manner, joints,
      arêtes, ledges and creases parting it into faces that take the light their own ways, falling
      into the water at the tip of each point, with the turf rolling over its top and the rock
      breaking through the grass here and there. Its woods are birches and
      rowans, each crown a ball of clustered leaves shaded away from the light and throwing its
      shadow on the grass, gold and red in the fall and bare in winter, with bushes along the shore
      and tufts in the grass; all of it comes into finer detail as the view closes in. Where land
      rising from a coast hides the land behind it, it is drawn so, with nothing standing out past
      its outline. Each house is lit by the sun or the moon as the hives are, its walls and
      roofs turned from the light toned and hatched in the mountains' manner, so the shading swings
      across the village through the day. Its windows light one by one as the evening comes on,
      some going out late in the night and a few coming on again before dawn, and their light
      shimmers on the water below. Its rock and harbor wall bare as the tide goes out, its hills turn
      with the seasons, and lying snow whitens its roofs and hills. As the cold comes on the fires
      are lit one by one, and smoke rises from the chimneys, thinning as it goes and bending with
      the wind. The village, its hills and the
      far shore stand at their own distances, smaller and nearer the horizon the farther off they
      are, so they slide past one another and past the near land as the view pans. Sailboats work
      back and forth on the water in front of it, coming about at either end, and boats lie at its
      quay.
- [ ] Soil holds moisture. Rain wets the top layer, and water drains down, spreads sideways and
      evaporates near the surface. Underground water pockets and a water table stay wet.
- [x] A day and night cycle: the sun crosses the sky by day, the moon and stars come out at night,
      and the light on the sky, the wood and the flowers follows, warm at sunrise and sunset. A
      day takes three minutes at normal speed.
- [x] The days follow the season. In summer the sun rises early and sets late, about 3:50 to
      20:10 at midsummer, and climbs high at noon; in winter it keeps short, low hours, about 8:10
      to 15:50 at midwinter.
- [x] The sun is a plain disc, after the minimal sun of reference 10.
- [x] Rays of light stream from the sun by day and the moon by night, as shafts through the haze
      that turn slowly, broken where the mountains, the barn, the farmhouse, the wood and the ground
      stand against the light. How strong they are is set in the debug panel, from none to very
      intense; at the usual setting they are faint.
- [x] A range of mountains on the horizon behind the tree, after reference 10: ridgelines up to
      sharp peaks, in a far row and a lower near row with a saddle behind the tree. Spurs, forks
      and creases carved down their fronts part each peak into faces, with narrow bands along the
      ridges and spurs. By day the sky is a faintly cool blue and the mountains are cut from the
      warm paper, so they stand apart from it; the sun and moon set behind them.
- [x] The mountains' faces are lit by the sun: faces turned from it are hatched, the steepest
      most densely, and faces turned toward a low sun glow warm, so the shading swings across the
      range from morning to evening. The moon shades them more softly by night. They darken into
      silhouettes against sunrise, sunset and the night sky, and their lines turn pale by night.
- [x] By day the mountains take their colors, after the painters of the northern fjords: green
      lower slopes under a ragged treeline and warm rock above, the far range hazed blue, faces
      turned from the sun cooled toward blue and faces turned toward it warmed. The colors fade
      toward sunrise and sunset, leaving those to the glow and the silhouettes.
- [x] The mountains carry on below their feet. Wherever the ground dips below the horizon, their
      faces, spurs and ridges, their colors and their shading continue down behind it, so they
      never stop short at a line over empty land.
- [x] Snow lies on the peaks above a snowline that comes down the range as the year turns: a
      little on the tallest peaks at midsummer, down over the upper half of the far range by
      midwinter. It reaches farther down the hollow of each face than along the spurs beside it,
      and is shaded and hatched as the rock is, blue in shade, warm with the glow of sunrise and
      sunset, and pale by moonlight.
- [ ] The snow on the peaks needs another pass. As drawn it is a flat fill above the snowline,
      and it reads as minimal effort beside the carved faces. It should be more detailed and
      look better. How is still open.
- [ ] Rolling hills with wildflower meadows between the meadow and its mountains, sliding past at
      their own distances as the view pans.
- [x] A red barn stands on the farm beside the tree, true to size (7 m wide and 10 m long, its
      ridge at 5.8 m), so the tree's height can be judged by it. It is drawn as the village's
      houses are, seen from the ground: its gable end toward the view and its long side running
      back to the right; board-and-batten walls in barn red on a stone foundation, under a gambrel
      roof with a louvered cupola astride the ridge. White trim runs up its corners, round its
      windows and sills and along the edges of its roof. Its great doors are framed and braced in
      white X's and hung on iron strap hinges, with a hayloft door above them.
- [x] The barn is lit by the sun or the moon as the village is: faces turned from the light are
      toned and hatched, and the roof's overhang throws its shadow down the gable end and the long
      side, following the light through the day. Its windows light one by one as the evening comes
      on, and the lantern over its doors, hung on a bracket, lights and throws a pool of warm light
      on them. Snow whitens its roof, and it stands against the rays of the sun and the moon.
- [x] A weathervane stands on the barn's cupola: a rooster on an arrow over the arms of a compass
      lettered N, E, S and W. It swings round to point the way the wind blows, overshooting a little,
      wanders in light air, and holds where it was when the air is calm.
- [x] A white farmhouse stands on the farm to the left of the tree, true to size (its front 11.8 m
      long, its ridge at 7.5 m), after the modern farmhouses of the references, and drawn as the
      barn is: its front toward the view and its right gable end running back to the right.
      Board-and-batten walls under steep charcoal shingle roofs; a stone wing at its left end,
      gabled toward the view, with a great black-framed window under a cedar header; a deep porch
      along the rest of its front on cedar posts, stone piers and a cedar beam, under a standing-seam
      metal roof, with a gable over its stone steps; cedar trusses in both gables; two dormers in the
      roof; a stone chimney by the ridge under a black cap; black-framed windows and glass double
      doors with a lantern either side; two rocking chairs on the porch; and boxwood, lavender,
      hydrangeas and ornamental grass along its foot, each turning with the seasons.
- [x] The farmhouse is lit as the barn is: faces turned from the light are toned and hatched, the
      roofs' edges throw their shadows down the gables, and the porch throws its shadow on the wall
      behind it, the wall in shade at midday and the light reaching in under the beam, striped by
      the posts, as the sun sinks. Its rooms light one by one as the evening comes on, downstairs
      first and the bedrooms in the dormers later, and most go dark late in the night, a few coming
      on again before dawn; the lanterns by the door burn all night, pooling warm light on the
      wall. Snow whitens its roofs and lies along its ridge, smoke rises from its chimney once the
      cold comes on and bends with the wind, and it stands against the rays of the sun and the moon.
- [x] Rain and snow, each set from none to a downpour or a blizzard, fall across the scene, carried
      by the wind, and stop at the ground.
- [x] Every chunk of falling snow is a body of its own, carried by the wind, and settles on the
      first thing it meets: a flower, which catches its share and whitens; the barn or the
      farmhouse; or the ground. The snow belongs to the world rather than the view: there are as
      many flakes to each square meter of air wherever the view pans or zooms, and air coming into
      view is already snowing. Wood lets it by. Snow landing on a roof too steep to hold it rolls
      down and falls from the edge, and snow blown against a wall slides down it. Lying snow slides
      until it stands no steeper than snow can, so it slides off the roofs and drops from the eaves
      in chunks that fall all the way to the ground, and drifts pile against the walls the wind
      drives it into. The snow on the flowers weighs their limbs down, so a heavy fall bends them.
      Lying snow melts at a rate the player sets, faster in rain.
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
- [x] Low cloud lies over the scene as fog, thickest over the distant mountains and the farm's
      buildings.
- [ ] Sunlight travels across the scene as rays. Flowers absorb them; the ground and solid
      obstacles block them.
- [ ] Branches shade one another. Flowers and leaves flourish in open light.
- [ ] The tree casts a shadow that moves with the sun. At morning and evening the trunk and crown
      stretch long shadows over the farm hills, barn or cliff, and the shadow swings through the
      day.
- [ ] On the cliff, calm water reflects the tree; waves break up the reflection as the sea rises.
- [ ] Rain showers come and go.
- [x] Limits on growth: level edges, solid obstacles, and a sky ceiling that caps height.

## Wildlife

- [x] A tree in flower draws a swarm of bees for every 40 open flowers. The bees build a hive over
      half a day, hanging under low, sturdy, level wood among the flowers, in open air clear of
      other wood and the barn, and never within 8 m of another hive. Low wood leaves the hive in
      reach of a bear.
- [x] A hive is a golden bell ringed with bands of comb, with a door near its bottom and a rounded
      cap that wraps up over its wood, 36 cm tall and 27 cm across once finished. It hangs in front of the wood and behind the flowers. Its side
      turned from the sun, or the moon by night, is toned and hatched like the mountains, so the
      shading swings around it through the day and evens out under thick cloud. Its gold is lit
      like the flowers through the day and night, deepens to amber through the fall and weathers to
      pale straw by winter. A fallen hive keeps its colors where it lies. It
      swings from its wood with the wood's motion and the wind, and weighs on its limb, 1.5 kg
      once finished. Its comb holds against its weight, the wind, the snow on its shoulders and
      the shaking of the wood, up to three times a finished hive's weight. A hurricane or a hard shake tears it loose and it falls; it also
      falls with any limb cut or snapped under it, and its bees scatter. Swinging hard, as a hive
      on whippy wood does when a bear rocks the tree, works its comb loose within seconds; a
      steady lean in the wind is no swing and does not.
- [x] By day, bees fly out from a finished hive to the flowers nearby, dance about them a while
      and fly home; by night they stay in. Bees fly about a hive while they build it. A bee is drawn
      side on, facing the way it flies: a dark head and thorax, a gold abdomen banded in ink, and a
      grey blur of wings.
- [x] Birds fly across the scene as ink silhouettes like the tree, beating their wings and now
      and then gliding, as often as the player sets. Some, as many as the player sets, land on
      wood in view thick enough to take them and level enough to stand on, clear of the other
      birds there. A bird sitting on a limb weighs on it, so a thin limb sags under it; it sits a
      while and flies off, and flies off at once if its limb is cut or breaks.
- [ ] Birds build nests, and successful trees accumulate inhabitants over years.
- [x] A hive draws a bear after a while. The bear is an ink silhouette ringed with a thin line of
      the sky's color so it stands out against the trunk: one drawn outline of a black bear in
      profile, its back level to a modest rise at the shoulders, a small rounded ear, a straight
      muzzle ending in a blunt nose pad, and a mouth whose jaw drops open as it roars or chews,
      bent with its hips, shoulders and head. Each leg is one smooth outline down to its foot:
      long flat hind feet with heels, which roll over their toes as it walks, and forepaws with
      claws. It walks in along the ground, or runs.
- [x] A bear goes after the nearest hive. If the hive hangs low enough, it lifts its chest and
      swipes it down on all fours with one forepaw; if it can reach it reared up on its hind
      legs, it swipes it down so; else it shoves the trunk to shake it down. A swipe is aimed at
      the hive, and when the claws pass through it they strike it with the momentum of the paw
      and the bear behind it, swinging it and pulling on its comb; a solid swipe tears it loose
      and sends it flying. To shove, it rears with its hind feet planted and its forepaws on the
      bark; each shove it pivots back at the hips with its paws drawn to its chest, waits for the
      trunk to swing back to it, then lunges forward from the hips and drives its paws into the
      bark, rocking the tree like a swing pushed in time. On a slight trunk it pushes no harder
      than the roots can bear. It eats a hive it brings down and walks off, and gives up and
      walks off after 18 seconds at the tree.
- [x] A bear swiping at a hive, or shoving its tree, provokes it: every bee pours out over a couple
      of seconds with sixteen guards behind them, dives at the bear, sometimes stings it, hangs
      back a moment and dives again, and chases it a way when it leaves. Thirty stings drive it
      off at a run, so the more bees, the sooner it gives up. The bees calm down a while after
      the bear stops.
- [x] Wood falling on a bear strikes it by its weight and speed, and glances off. A light blow
      angers it: it rears and roars, and goes back at the hive longer and harder. A heavier one
      drives it off at a run. One heavy and fast enough kills it: it collapses where it stands,
      lies a while, and fades.

## Sound

- [ ] A procedural soundscape follows the simulation: wind through branches, individual creaks
      under stress, waves, distant birds, bees, rain on leaves and snow-muted ambience.

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
      down its left edge for each page: the level, weather, the sea, the tree, flowers, and wildlife. The scene narrows as the
      panel opens. Time controls stay at the top of every page, and a button at the bottom puts
      every setting back to its default.
- [x] A plain black strip down the left of the scene, kept for tools.
- [x] Time controls: pause the simulation, or run it at normal, double or quadruple speed.
- [x] Weather page: the time of day, set by hand or played on its own at the simulation's speed,
      and how strongly rays of light stream from the sun and the moon, from off to very intense;
      the season; the wind: a compass whose arrow you drag to point where it blows toward, a
      strength slider, and a choice of wind model with a description of each; how hard it rains
      and snows, and how fast lying snow melts; and how much of the sky the clouds cover and how
      high they hang.
- [x] Level page: which level the tree grows in, which plants a tree there afresh; whether
      mountains line its horizon; and whether the grass is drawn in its colors, and how tall it
      grows.
- [x] Sea page: how high and how long the swell is; how strongly the wind raises waves of its own;
      the sea's momentum, how long it takes to build or calm; the tide, set by hand or rising and
      falling with the day. A line reads out how high the waves stand now, by the Douglas sea scale.
- [x] Tree page: the species planted, which plants a tree of it afresh, with a description of how
      each grows; switch between steer-and-grow and flow mode and set the flow rate; multipliers
      on how much the wood and the roots can take; and an overlay showing how close each joint is
      to breaking.
- [x] Flowers page: whether flowers are grown by the tree, as they are to begin with, or placed by
      hand; one size for all of them, from a fifth to five times the usual, which grows clusters
      into mounds, or a willow's strands into cascades; and how hard their stems hold. For a willow the
      page speaks of its strands.
- [x] Wildlife page: whether swarms of bees come on their own; a button that finishes building
      every hive within a couple of seconds; how many birds come by each minute, and how many of
      them land; whether hives draw bears, a button that sends a bear in, a list of a bear's
      animations to show one playing in place, and a button that clears the bears away. A
      button, or holding H, makes the next click on a limb hang a hive from it there.
