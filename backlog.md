# Backlog

Open thoughts. Nothing here is decided.

## Root view

Right now the ground and the tree are the same color, just very dark. That reads well, and it should stay the default.

A button flips into a mode for looking at the root system. In that mode, everything above the ground becomes secondary — opaque, blurry, or some other way of receding — and the ground shows the roots. The roots should read as distinct from the ground. Maybe the ground shifts color a little, or becomes opaque so the roots stand out. The two views should feel like they trade places: roots matter in this mode, and turning it off puts the above-ground tree back in focus.

Inside the root view:

- The default is the shape and size already used above ground, so the roots can be steered the same way.
- A toggle shows how much water each root is bringing in. Color is one option: more water reads more blue, less water more brown or black. Another option is animation. Tiny droplets enter through the tendrils. When two meet they join into one larger droplet, and they travel back up toward the base of the trunk. Frequency and size of the droplets show how much or how little is being taken up. Small tendrils pull in small droplets; as they move up the roots the droplets get larger and combine.
- A separate overlay for strength or structural strength is a maybe. Branch size already makes that fairly obvious, so it may not be worth it.

While the ground is visible, other underground things could show up too: an underground lake, or rocks the roots should avoid. Interesting, not urgent.

## Above-ground physics, roots as limits

The physics above ground and the physics below ground should be clearly separate. They may already be mostly separate; make that explicit.

The physics engine only cares about the above-ground tree. Roots do not simulate as their own bodies. What they contribute is a constraint on what that tree is allowed to be.

A couple of ways that could work:

- Roots add weight at the base of the trunk, so a more heavily rooted tree is physically the same as one with more weight planted there.
- Root amount limits how tall or long the trunk can get. Bigger roots are required before the tree can grow taller. Something like a level: to pass a height or length (five meters, say), you need a corresponding amount of root mass. An integer tied to how much root you have, and that integer is the requirement you have to meet before you can build past that height or length.

Either way, the physics stays simple because it only sees the above-ground tree. In play you also are not looking at the roots while you care about the physics, so those two concerns stay apart.

## Growth and decay

Water is the currency. Resources come up the trunk and, left alone, point upward. If you do nothing while more water comes in, the tree just gets taller, until it hits some maximum height. Steering a new branch also steers where that growth goes.

Decay rises with tree mass: more branches, a thicker trunk, a taller trunk. A larger branch decays faster. A larger stem decays faster. More tree means a higher decay rate.

If more is coming in than the decay rate, that part keeps growing. If less is coming in than the decay rate, it starts to die from the leaf nodes: the top of the trunk, the edges of the branches. There is no separate homeostasis rate that overrides this. Homeostasis is just the point where what comes in matches decay, so the part stays as it is. Branches, stems, and flowers all work that way from the start.

## Building branches

Growth is a continual process. It keeps going on its own over time. You do not press a button to send water or energy to a spot. You only dictate where the flow goes.

You place where a branch starts. Think of that point as a spout. Click it and set how much of the flow goes into the branch versus on up the trunk. Fifty percent, for example.

Visually this is the reverse of the water droplets. Dots stand for the plant's energy. The name is unclear. They guessed chloroplasts and were not sure. The dots start large. At a spout they split by the share you set, then travel out along the branch. Whatever arrives at the end makes that end longer, in the direction it is currently being steered.

Branches have stems, and stems have their own nozzles, with the same kind of split: how much of this branch's flow goes into each stem.

A flower is another node type, and it is always a leaf. It gets resources dedicated to it the same way a branch or a stem does, and it needs enough of them. It also brings in light energy, which is a different currency. How that connects, and why you would use it, is still open.

On each valve, a few settings feel right, even if the exact set is not settled: give it everything, hold it where incoming matches decay, or turn the valve off.
